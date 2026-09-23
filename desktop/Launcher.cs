using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program
{
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    internal static readonly string StatePath = Path.Combine(Root, ".aqua-launcher.json");
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    internal static bool SmokeTest;

    [STAThread]
    private static void Main(string[] args)
    {
        SmokeTest = Array.IndexOf(args, "--smoke-test") >= 0;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string key;
        using (var sha = SHA256.Create())
            key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()))).Replace("-", "");
        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\AquaLevelLab-" + key, out ownsMutex))
        {
            if (!ownsMutex)
            {
                try
                {
                    var state = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(StatePath));
                    var url = Convert.ToString(state["url"]);
                    VerifyServer(url);
                    if (!SmokeTest) OpenBrowser(url);
                }
                catch
                {
                    if (!SmokeTest) MessageBox.Show("起動の準備中です。少し待ってから、もう一度開いてください。", "Aqua Level Lab");
                    Environment.ExitCode = 1;
                }
                return;
            }
            try { Application.Run(new LauncherForm()); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    internal static void VerifyServer(string address)
    {
        Uri url;
        if (!Uri.TryCreate(address, UriKind.Absolute, out url) || url.Scheme != "http" || url.Host != "127.0.0.1")
            throw new InvalidOperationException("Invalid local application address.");
        var request = (HttpWebRequest)WebRequest.Create(address + "/api/health");
        request.Timeout = 5000;
        request.ReadWriteTimeout = 5000;
        request.Proxy = null;
        using (var response = request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream()))
        {
            var health = Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            if (Convert.ToString(health["application"]) != "aqua-level-lab")
                throw new InvalidOperationException("Unexpected application response.");
        }
    }

    internal static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}

internal sealed class LauncherForm : Form
{
    private readonly Label status = new Label();
    private readonly Button open = new Button();
    private readonly System.Windows.Forms.Timer startupTimer = new System.Windows.Forms.Timer();
    private Process runtime;
    private string address;
    private string lastError = "";
    private bool closing;

    internal LauncherForm()
    {
        Text = "Aqua Level Lab";
        Font = new Font("Yu Gothic UI", 10);
        ClientSize = new Size(450, 160);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        Icon = SystemIcons.Application;
        status.SetBounds(24, 20, 400, 68);
        status.Text = "起動しています…";
        open.SetBounds(24, 104, 236, 36);
        open.Text = "ブラウザーを開く";
        open.Enabled = false;
        open.Click += delegate { TryOpenBrowser(); };
        var stop = new Button { Text = "アプリを終了" };
        stop.SetBounds(278, 104, 148, 36);
        stop.Click += delegate { Close(); };
        Controls.AddRange(new Control[] { status, open, stop });
        startupTimer.Interval = 30000;
        startupTimer.Tick += delegate { Fail("起動が完了しませんでした。\r\n" + lastError); };
        if (Program.SmokeTest) { Opacity = 0; ShowInTaskbar = false; }
        Shown += delegate { StartRuntime(); };
    }

    private void StartRuntime()
    {
        try
        {
            var node = Path.Combine(Program.Root, "runtime", "node.exe");
            if (!File.Exists(node) || !File.Exists(Path.Combine(Program.Root, "server.js")))
                throw new FileNotFoundException("ZIP をすべて展開してから AquaLevelLab.exe を開いてください。runtime フォルダーも必要です。");
            var start = new ProcessStartInfo(node, "\"" + Path.Combine(Program.Root, "server.js") + "\" --desktop");
            start.WorkingDirectory = Program.Root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            start.StandardErrorEncoding = Encoding.UTF8;
            runtime = new Process { StartInfo = start, EnableRaisingEvents = true };
            runtime.OutputDataReceived += ReadOutput;
            runtime.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data)) lastError = (lastError + "\r\n" + e.Data).Trim();
            };
            runtime.Exited += delegate { OnUi(delegate { if (!closing) Fail("アプリが停止しました。\r\n" + lastError); }); };
            runtime.Start();
            runtime.BeginOutputReadLine();
            runtime.BeginErrorReadLine();
            startupTimer.Start();
        }
        catch (Exception error) { Fail(error.Message); }
    }

    private void ReadOutput(object sender, DataReceivedEventArgs e)
    {
        if (String.IsNullOrEmpty(e.Data) || !e.Data.StartsWith("{")) return;
        try
        {
            var message = Program.Json.Deserialize<Dictionary<string, object>>(e.Data);
            if (Convert.ToString(message["type"]) != "aqua-ready") return;
            int port = Convert.ToInt32(message["port"]);
            if (port < 1 || port > 65535) return;
            OnUi(delegate { Ready("http://127.0.0.1:" + port); });
        }
        catch { }
    }

    private void Ready(string url)
    {
        try
        {
            Program.VerifyServer(url);
            address = url;
            File.WriteAllText(Program.StatePath, Program.Json.Serialize(new { url = address, pid = runtime.Id }));
            startupTimer.Stop();
            status.Text = "アプリを起動しました。\r\n" + address;
            open.Enabled = true;
            if (Program.SmokeTest) { Environment.ExitCode = 0; Close(); }
            else TryOpenBrowser();
        }
        catch (Exception error) { Fail(error.Message); }
    }

    private void TryOpenBrowser()
    {
        try { Program.OpenBrowser(address); }
        catch (Exception error) { MessageBox.Show("ブラウザーで次のアドレスを開いてください。\r\n" + address + "\r\n" + error.Message, Text); }
    }

    private void OnUi(Action action)
    {
        if (closing || IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    private void Fail(string message)
    {
        if (closing) return;
        startupTimer.Stop();
        Environment.ExitCode = 1;
        try { File.WriteAllText(Path.Combine(Program.Root, "aqua-launcher-error.log"), message, Encoding.UTF8); }
        catch (IOException) { }
        if (!Program.SmokeTest) MessageBox.Show(message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        closing = true;
        startupTimer.Dispose();
        if (runtime != null)
        {
            try { if (!runtime.HasExited) { runtime.Kill(); runtime.WaitForExit(3000); } }
            catch (InvalidOperationException) { }
            runtime.Dispose();
        }
        if (address != null && File.Exists(Program.StatePath)) File.Delete(Program.StatePath);
        base.OnFormClosed(e);
    }
}
