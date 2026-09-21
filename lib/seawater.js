// EOS-80 port of python-seawater (MIT); see vendor/seawater.LICENSE.
const poly = (c, t) => c.reduceRight((v, a) => v * t + a, 0);
export function depthFromPressure(p, latitude) {
  const x = Math.sin(latitude * Math.PI / 180) ** 2;
  const gravity = 9.780318 * (1 + (5.2788e-3 + 2.36e-5 * x) * x) + 1.092e-6 * p;
  return (((-1.82e-15 * p + 2.279e-10) * p - 2.2512e-5) * p + 9.72659) * p / gravity;
}
export function pressureFromDepth(z, latitude) {
  const c = 0.00592 + Math.sin(Math.abs(latitude) * Math.PI / 180) ** 2 * 0.00525;
  return ((1 - c) - Math.sqrt((1 - c) ** 2 - 8.84e-6 * z)) / 4.42e-6;
}
export function density(s, temperature, pressure = 0) {
  const t = temperature * 1.00024, p = pressure / 10, root = Math.sqrt(s);
  const rho = poly([999.842594, .06793952, -.00909529, .0001001685, -1.120083e-6, 6.536332e-9], t)
    + poly([.824493, -.0040899, .000076438, -8.2467e-7, 5.3875e-9], t) * s
    + poly([-.00572466, .00010227, -1.6546e-6], t) * s * root + .00048314 * s * s;
  const aw = poly([3.239908, .00143713, .000116092, -5.77905e-7], t);
  const bw = poly([8.50935e-5, -6.12293e-6, 5.2787e-8], t);
  const kw = poly([19652.21, 148.4206, -2.327105, .01360477, -5.155288e-5], t);
  const a = aw + (poly([.0022838, -1.0981e-5, -1.6078e-6], t) + 1.91075e-4 * root) * s;
  const b = bw + poly([-9.9348e-7, 2.0816e-8, 9.1697e-10], t) * s;
  const k0 = kw + (poly([54.6746, -.603459, .0109987, -6.167e-5], t) + poly([.07944, .016483, -.00053009], t) * root) * s;
  return rho / (1 - p / (k0 + (a + b * p) * p));
}
