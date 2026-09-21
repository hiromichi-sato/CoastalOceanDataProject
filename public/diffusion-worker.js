importScripts('./vendor/numeric-1.2.6.min.js');
self.onmessage = async ({ data }) => {
  try { const { solveDiffusion } = await import('./diffusion.js'); self.postMessage({ result: solveDiffusion(data, self.numeric) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
