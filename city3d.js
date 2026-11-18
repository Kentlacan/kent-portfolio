/*
 * city3d.js — a small, dependency-free WebGL2 city for Kent's portfolio.
 * Futuristic towers, low-rise buildings, streets with traffic, trees and drones.
 * Palette: Blackstone / Whiteout base, warm yellow light so it never competes
 * with the Nitro Orange text that sits on top of it.
 */
(function () {
  'use strict';

  var hosts = Array.prototype.slice.call(document.querySelectorAll('.city-scene[data-scene]'));
  if (!hosts.length) return;

  var QUALITY = { scale: 1, skip: false };
  var REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FINE = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);

  /* ---------- colour ---------- */
  function lin(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) { return Math.pow(c / 255, 2.2); });
  }
  var C = {
    bg: lin('#1F1E1C'),
    road: lin('#181715'),
    walk: lin('#2D2B28'),
    curb: lin('#3A3834'),
    dark1: lin('#3B3936'),
    dark2: lin('#47443F'),
    dark3: lin('#55524C'),
    light1: lin('#E4E1DA'),
    light2: lin('#CFCBC3'),
    glass: lin('#2A2C2E'),
    yellow: lin('#FFC23D'),
    yellowSoft: lin('#FFD47A'),
    win: lin('#FFC95E'),
    orange: lin('#FF5F1F'),
    tail: lin('#E0401A'),
    stripe: lin('#8C8981'),
    trunk: lin('#5A4B3C'),
    leaf1: lin('#5C7A47'),
    leaf2: lin('#4A683D'),
    leaf3: lin('#7A9455'),
    grass: lin('#3C5232'),
    solar: lin('#2C3036'),
    floor: lin('#1B1A18'),
    belt: lin('#262522'),
    screen: lin('#FFF1CF')
  };

  /* ---------- tiny math ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function persp(fovy, asp, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), o = new Float32Array(16);
    o[0] = f / asp; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  }
  function ortho(l, r, b, t, n, f) {
    var o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x), o = new Float32Array(16);
    o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
    o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
    o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
    o[12] = -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]);
    o[13] = -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]);
    o[14] = -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]);
    o[15] = 1;
    return o;
  }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  /* ---------- geometry (flat-shaded, pivot at the base) ---------- */
  function Geo() { this.p = []; this.n = []; }
  Geo.prototype.tri = function (a, b, c, n) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  };
  Geo.prototype.quad = function (a, b, c, d, n) { this.tri(a, b, c, n); this.tri(a, c, d, n); };
  function outward(a, b, c, ref) {
    var n = norm(cross(sub(b, a), sub(c, a)));
    var m = [(a[0] + b[0] + c[0]) / 3 - ref[0], (a[1] + b[1] + c[1]) / 3 - ref[1], (a[2] + b[2] + c[2]) / 3 - ref[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }
  function prism(sides, rot, r) {
    var g = new Geo(), k, a0, a1, am;
    r = r || 0.5;
    for (k = 0; k < sides; k++) {
      a0 = rot + (k / sides) * Math.PI * 2; a1 = rot + ((k + 1) / sides) * Math.PI * 2; am = (a0 + a1) / 2;
      var p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
      g.quad(p0, p1, [p1[0], 1, p1[2]], [p0[0], 1, p0[2]], [Math.cos(am), 0, Math.sin(am)]);
      g.tri([0, 1, 0], [p0[0], 1, p0[2]], [p1[0], 1, p1[2]], [0, 1, 0]);
      g.tri([0, 0, 0], p1, p0, [0, -1, 0]);
    }
    return g;
  }
  function pyramid(sides, rot) {
    var g = new Geo(), ref = [0, 0.3, 0];
    for (var k = 0; k < sides; k++) {
      var a0 = rot + (k / sides) * Math.PI * 2, a1 = rot + ((k + 1) / sides) * Math.PI * 2;
      var p0 = [Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5], p1 = [Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5], ap = [0, 1, 0];
      g.tri(p0, p1, ap, outward(p0, p1, ap, ref));
      g.tri([0, 0, 0], p1, p0, [0, -1, 0]);
    }
    return g;
  }
  function ico() {
    var t = (1 + Math.sqrt(5)) / 2, g = new Geo();
    var v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map(function (p) { var q = norm(p); return [q[0] * 0.5, q[1] * 0.5 + 0.5, q[2] * 0.5]; });
    var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    f.forEach(function (i) { g.tri(v[i[0]], v[i[1]], v[i[2]], outward(v[i[0]], v[i[1]], v[i[2]], [0, 0.5, 0])); });
    return g;
  }
  function dashedRing(arcs, fill) {
    var g = new Geo(), R = 0.5, t = 0.035, h = 0.5, segs = 6;
    for (var a = 0; a < arcs; a++) {
      var s0 = (a / arcs) * Math.PI * 2, s1 = s0 + (fill / arcs) * Math.PI * 2;
      for (var s = 0; s < segs; s++) {
        var b0 = s0 + (s1 - s0) * (s / segs), b1 = s0 + (s1 - s0) * ((s + 1) / segs), bm = (b0 + b1) / 2;
        var c0 = Math.cos(b0), n0 = Math.sin(b0), c1 = Math.cos(b1), n1 = Math.sin(b1);
        var o0 = [c0 * (R + t), 0, n0 * (R + t)], o1 = [c1 * (R + t), 0, n1 * (R + t)];
        var i0 = [c0 * (R - t), 0, n0 * (R - t)], i1 = [c1 * (R - t), 0, n1 * (R - t)];
        var up = function (p) { return [p[0], h * 2, p[2]]; };
        g.quad(o0, o1, up(o1), up(o0), [Math.cos(bm), 0, Math.sin(bm)]);
        g.quad(i1, i0, up(i0), up(i1), [-Math.cos(bm), 0, -Math.sin(bm)]);
        g.quad(up(o0), up(o1), up(i1), up(i0), [0, 1, 0]);
        g.quad(o1, o0, i0, i1, [0, -1, 0]);
        if (s === 0) g.quad(i0, o0, up(o0), up(i0), [Math.sin(b0), 0, -Math.cos(b0)]);
        if (s === segs - 1) g.quad(o1, i1, up(i1), up(o1), [-Math.sin(b1), 0, Math.cos(b1)]);
      }
    }
    return g;
  }

  function sphere() {
    var t = (1 + Math.sqrt(5)) / 2, g = new Geo(), c = [0, 0.5, 0];
    var v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    function mid(a, b) { return norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]); }
    function P(q) { return [q[0] * 0.5, q[1] * 0.5 + 0.5, q[2] * 0.5]; }
    f.forEach(function (i) {
      var a = v[i[0]], b = v[i[1]], d = v[i[2]], ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
      [[a, ab, da], [ab, b, bd], [da, bd, d], [ab, bd, da]].forEach(function (q) {
        var A = P(q[0]), B = P(q[1]), D = P(q[2]);
        g.tri(A, B, D, outward(A, B, D, c));
      });
    });
    return g;
  }
  // folded paper plane, nose pointing +z, centred on the origin
  function paperPlane() {
    var g = new Geo(), N = [0, 0.04, 0.5], BL = [-0.42, 0.1, -0.5], BR = [0.42, 0.1, -0.5], BC = [0, 0.02, -0.5], K = [0, -0.16, -0.5];
    g.tri(N, BL, BC, norm([0.04, 1, 0.1]));
    g.tri(N, BC, BR, norm([-0.04, 1, 0.1]));
    g.tri(N, BC, K, [1, 0, 0]);
    return g;
  }
  // check mark standing in the XY plane, facing +z
  function checkMark() {
    var g = new Geo();
    function slab(x0, y0, x1, y1, w, d) {
      var ux = x1 - x0, uy = y1 - y0, l = Math.hypot(ux, uy); ux /= l; uy /= l;
      var nx = -uy * w / 2, ny = ux * w / 2, z0 = -d / 2, z1 = d / 2;
      var a = [x0 + nx, y0 + ny], b = [x1 + nx, y1 + ny], c = [x1 - nx, y1 - ny], e = [x0 - nx, y0 - ny];
      function q(p, z) { return [p[0], p[1], z]; }
      g.quad(q(a, z1), q(e, z1), q(c, z1), q(b, z1), [0, 0, 1]);
      g.quad(q(a, z0), q(b, z0), q(c, z0), q(e, z0), [0, 0, -1]);
      g.quad(q(a, z0), q(a, z1), q(b, z1), q(b, z0), norm([-uy, ux, 0]));
      g.quad(q(e, z0), q(c, z0), q(c, z1), q(e, z1), norm([uy, -ux, 0]));
      g.quad(q(b, z0), q(b, z1), q(c, z1), q(c, z0), [ux, uy, 0]);
      g.quad(q(a, z0), q(e, z0), q(e, z1), q(a, z1), [-ux, -uy, 0]);
    }
    slab(-0.42, 0.02, -0.12, -0.3, 0.16, 0.1);
    slab(-0.17, -0.3, 0.46, 0.42, 0.16, 0.1);
    return g;
  }
  // rotate a local offset by tiltX then yaw (same order as the shader)
  function xf(yaw, tilt, lx, ly, lz) {
    var ct = Math.cos(tilt), st = Math.sin(tilt), y1 = ct * ly - st * lz, z1 = st * ly + ct * lz;
    var c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * lx + s * z1, y1, -s * lx + c * z1];
  }
  function put(B, o, yaw, tilt, l, sc, col, em, ty, seed, rise, ex, yawExtra) {
    var p = xf(yaw, tilt, l[0], l[1], l[2]);
    B.add(o[0] + p[0], o[1] + p[1], o[2] + p[2], yaw + (yawExtra || 0), sc[0], sc[1], sc[2], tilt, col, em || 0, ty || 0, seed || 0, rise, ex);
  }
  function orient(v) {
    return [Math.atan2(v[0], v[2]), -Math.atan2(v[1], Math.hypot(v[0], v[2]))];
  }

  /* ---------- shaders ---------- */
  var VS_COMMON = [
    'layout(location=0) in vec3 aP;',
    'layout(location=1) in vec3 aN;',
    'layout(location=2) in vec4 iPos;',
    'layout(location=3) in vec4 iScl;',
    'layout(location=4) in vec4 iCol;',
    'layout(location=5) in vec4 iExt;',
    'uniform float uT;',
    'uniform float uRise;',
    'mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}',
    'mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}',
    'vec3 place(out mat3 R){',
    '  vec3 p=aP*iScl.xyz;',
    '  float ty=iExt.x;',
    '  if(ty>1.5&&ty<2.5){float h=aP.y*aP.y;p.x+=sin(uT*1.4+iExt.y*6.283)*0.07*h*iScl.y;p.z+=cos(uT*1.1+iExt.y*4.0)*0.05*h*iScl.y;}',
    '  float ry=iPos.w;',
    '  if(ty>4.5&&ty<5.5){ry+=uT*iExt.w;}',
    '  R=rotY(ry)*rotX(iScl.w);',
    '  vec3 w=R*p+iPos.xyz;',
    '  float r=clamp((uRise-iExt.z)/1.2,0.,1.);r=1.-(1.-r)*(1.-r)*(1.-r);',
    '  w.y*=max(r,0.0001);',
    '  return w;',
    '}'
  ].join('\n');

  var VS = '#version 300 es\n' + VS_COMMON + [
    '',
    'uniform mat4 uVP;uniform mat4 uLVP;',
    'out vec3 vN;out vec3 vW;out vec3 vO;out vec3 vON;out vec4 vLS;flat out vec4 vCol;flat out vec4 vExt;',
    'void main(){',
    '  mat3 R;vec3 w=place(R);',
    '  vN=normalize(R*(aN/iScl.xyz));vW=w;vO=aP*iScl.xyz;vON=aN;vCol=iCol;vExt=iExt;',
    '  vLS=uLVP*vec4(w,1.);',
    '  gl_Position=uVP*vec4(w,1.);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;precision highp sampler2DShadow;',
    'in vec3 vN;in vec3 vW;in vec3 vO;in vec3 vON;in vec4 vLS;flat in vec4 vCol;flat in vec4 vExt;',
    'uniform sampler2DShadow uSM;uniform float uUseSM;',
    'uniform vec3 uL;uniform vec3 uSun;uniform vec3 uSky;uniform vec3 uGnd;uniform vec3 uFog;uniform vec3 uWin;',
    'uniform vec3 uEye;uniform float uFogD;uniform float uRad;uniform float uT;',
    'out vec4 oc;',
    'float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float shade(){',
    '  if(uUseSM<0.5)return 1.;',
    '  vec3 c=vLS.xyz/vLS.w*0.5+0.5;',
    '  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.)return 1.;',
    '  vec2 ts=1./vec2(textureSize(uSM,0));float s=0.;',
    '  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)s+=texture(uSM,vec3(c.xy+vec2(x,y)*ts,c.z-0.0018));',
    '  return s/9.;',
    '}',
    'void main(){',
    '  vec3 n=normalize(vN);',
    '  vec3 base=vCol.rgb;float ty=vExt.x;',
    '  vec3 em=vec3(0.);',
    '  if(ty>0.5&&ty<1.5){',
    '    vec3 on=normalize(vON);',
    '    if(abs(on.y)<0.5){',
    '      float u=abs(on.x)>abs(on.z)?vO.z:vO.x;',
    '      if(vExt.w>0.5)u=atan(vO.z,vO.x)*length(vO.xz);',
    '      bool ribbon=dot(base,vec3(0.3,0.5,0.2))>0.3;',
    '      vec2 g=vec2(u/(ribbon?0.9:0.27),vO.y/0.34);vec2 cell=floor(g);vec2 f=fract(g);',
    '      float win=ribbon?step(0.05,f.x)*step(0.30,f.y)*step(f.y,0.72):step(0.16,f.x)*step(f.x,0.84)*step(0.24,f.y)*step(f.y,0.80);',
    '      float hs=h1(cell+vExt.y*91.7);',
    '      float lit=step(0.70,h1(cell*1.37+vExt.y*17.3+floor(uT/(7.+hs*11.)+hs*5.)*0.731));',
    '      base=mix(base,ribbon?base*0.30+vec3(0.01,0.012,0.015):base*0.45+vec3(0.012,0.014,0.017),win);',
    '      em+=uWin*win*lit*(0.35+0.65*hs);',
    '    }',
    '  }',
    '  if(ty>2.5&&ty<3.5)em+=base*vCol.a;',
    '  if(ty>3.5&&ty<4.5)em+=base*vCol.a*(0.15+0.85*step(0.72,fract(uT*0.55+vExt.y)));',
    '  if(ty>4.5&&ty<5.5)em+=base*vCol.a;',
    '  float d=max(dot(n,uL),0.);',
    '  float sh=d>0.?shade():1.;',
    '  vec3 hemi=mix(uGnd,uSky,n.y*0.5+0.5);',
    '  vec3 col=base*(hemi+uSun*d*sh)+em;',
    '  float dist=length(vW-uEye);',
    '  float fog=1.-exp(-pow(dist*uFogD,2.));',
    '  fog=max(fog,smoothstep(0.62,1.0,length(vW.xz)/uRad));',
    '  col=mix(col,uFog,clamp(fog,0.,1.));',
    '  float dz=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));',
    '  oc=vec4(pow(max(col,0.),vec3(1./2.2))+(dz-0.5)/255.+0.5/255.,1.);',
    '}'
  ].join('\n');

  var VS_SH = '#version 300 es\n' + VS_COMMON + '\nuniform mat4 uLVP;\nvoid main(){mat3 R;vec3 w=place(R);gl_Position=uLVP*vec4(w,1.);}';
  var FS_SH = '#version 300 es\nprecision mediump float;\nvoid main(){}';

  function compile(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  /* ---------- instance batches ---------- */
  var STRIDE = 16;
  function Batch(gl, geo, cap, dynamic) {
    this.gl = gl; this.cap = cap; this.count = 0; this.dynamic = dynamic;
    this.data = new Float32Array(cap * STRIDE);
    this.verts = geo.p.length / 3;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.p), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.n), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (var i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(2 + i); gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.bindVertexArray(null);
  }
  // add(x,y,z,rotY, sx,sy,sz,tiltX, colour, emissive, type, seed, riseDelay, extra)
  Batch.prototype.add = function (x, y, z, ry, sx, sy, sz, tx, col, em, ty, seed, rise, ex) {
    if (this.count >= this.cap) { this.over = (this.over || 0) + 1; return; }
    var d = this.data, o = this.count * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = ry;
    d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = sz; d[o + 7] = tx || 0;
    d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2]; d[o + 11] = em || 0;
    d[o + 12] = ty || 0; d[o + 13] = seed || 0; d[o + 14] = rise == null ? -100 : rise; d[o + 15] = ex || 0;
    this.count++;
  };
  Batch.prototype.upload = function () {
    var gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE);
  };
  Batch.prototype.draw = function () {
    if (!this.count) return;
    var gl = this.gl; gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.verts, this.count);
  };

  /* ---------- scene presets ---------- */
  var PRESETS = {
    hero: { seed: 11, n: 7, az: 0.66, el: 0.56, fov: 26, fit: 29, fitW: 40, cx: 0.85, offY: -0.12, mBottom: 10, win: 1.0, drones: 6 },
    contact: { kind: 'hub', seed: 29, az: 0.4, el: 0.52, fov: 26, fit: 8.5, fitW: 21, cx: 0.76, offY: 0.04, ty: 1.6, span: 22, mLift: 0.42, mBottom: 175, win: 1.0 },
    case: { seed: 53, n: 7, az: -0.9, el: 0.6, fov: 26, fit: 29, fitW: 37, cx: 0.82, offY: 0.04, mBottom: 10, win: 1.1, drones: 5 }
  };

  /* ---------- city ---------- */
  function City(host) {
    this.host = host;
    var key = host.getAttribute('data-scene');
    this.cfg = PRESETS[key] || PRESETS.hero;
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .8s ease';
    var gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl2');
    this.canvas = canvas; this.gl = gl;
    host.insertBefore(canvas, host.firstChild);
    this.prog = compile(gl, VS, FS);
    this.shProg = compile(gl, VS_SH, FS_SH);
    this.geo = {
      box: prism(4, Math.PI / 4, Math.SQRT1_2),
      oct: prism(8, Math.PI / 8),
      hex: prism(6, 0),
      cyl: prism(16, 0),
      cone: pyramid(8, Math.PI / 8),
      leaf: ico(),
      ring: dashedRing(5, 0.62),
      sph: sphere(),
      plane: paperPlane(),
      check: checkMark()
    };
    this.setupShadow();
    this.build();
    this.t = 0; this.riseT = REDUCE ? 100 : 0; this.started = false;
    this.mx = 0; this.my = 0; this.tmx = 0; this.tmy = 0;
    this.visible = false; this.shown = false;
    var self = this;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.dead = true; self.fallback(); });
  }

  City.prototype.setupShadow = function () {
    var gl = this.gl, size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (window.innerWidth < 820) size = Math.min(size, 1024);
    this.smSize = size;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    this.useSM = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.smTex = tex; this.smFb = fb;
  };

  City.prototype.build = function () {
    var gl = this.gl, G = this.geo, cfg = this.cfg, R = rng(cfg.seed);
    var S = this.S = {
      box: new Batch(gl, G.box, 6000, false),
      oct: new Batch(gl, G.oct, 300, false),
      hex: new Batch(gl, G.hex, 3000, false),
      cyl: new Batch(gl, G.cyl, 120, false),
      cone: new Batch(gl, G.cone, 1200, false),
      leaf: new Batch(gl, G.leaf, 2000, false),
      ring: new Batch(gl, G.ring, 40, false),
      sph: new Batch(gl, G.sph, 60, false)
    };
    this.D = {
      box: new Batch(gl, G.box, 1400, true),
      cyl: new Batch(gl, G.cyl, 120, true),
      sph: new Batch(gl, G.sph, 80, true),
      plane: new Batch(gl, G.plane, 24, true),
      check: new Batch(gl, G.check, 8, true)
    };
    this.dyn = this.D.box;
    if (cfg.kind === 'hub') {
      this.buildHub(R);
      for (var hk in S) S[hk].upload();
      return;
    }

    var BLK = 7, ROAD = 2, PITCH = BLK + ROAD, N = cfg.n, half = (N - 1) / 2;
    var E = (half + 1) * PITCH + 6;              // road length (beyond the fade)
    this.rad = (half + 0.35) * PITCH;            // fade radius
    this.E = E; this.PITCH = PITCH; this.ROAD = ROAD;
    var roads = [];
    for (var k = -half - 0.5; k <= half + 0.51; k += 1) roads.push(k * PITCH);
    this.roads = roads;

    // ground
    S.box.add(0, -0.2, 0, 0, 400, 0.2, 400, 0, C.road, 0, 0, 0);
    // road markings
    roads.forEach(function (r) {
      for (var s = -E; s < E; s += 1.1) {
        var near = roads.some(function (q) { return Math.abs(q - s) < ROAD / 2 + 0.4; });
        if (near) continue;
        S.box.add(s, 0, r, 0, 0.5, 0.012, 0.06, 0, C.yellow, 0.55, 3, 0);
        S.box.add(r, 0, s, 0, 0.06, 0.012, 0.5, 0, C.yellow, 0.55, 3, 0);
      }
    });
    // crosswalks near the centre
    roads.forEach(function (rx) {
      roads.forEach(function (rz) {
        if (Math.hypot(rx, rz) > PITCH * 2.2) return;
        for (var i = -3; i <= 3; i++) {
          var o = i * 0.26;
          [[rx + o, rz - ROAD / 2 - 0.35, 0.13, 0.5], [rx + o, rz + ROAD / 2 + 0.35, 0.13, 0.5],
           [rx - ROAD / 2 - 0.35, rz + o, 0.5, 0.13], [rx + ROAD / 2 + 0.35, rz + o, 0.5, 0.13]].forEach(function (c) {
            S.box.add(c[0], 0, c[1], 0, c[2], 0.012, c[3], 0, C.stripe, 0, 0, 0);
          });
        }
      });
    });

    var self = this;
    var center = [0, 0];
    for (var bi = -half; bi <= half; bi++) {
      for (var bj = -half; bj <= half; bj++) {
        var cx = bi * PITCH, cz = bj * PITCH, dist = Math.hypot(bi, bj);
        var delay = 0.15 + dist * 0.16 + R() * 0.25;
        // sidewalk plate + curb
        S.box.add(cx, 0, cz, 0, BLK, 0.14, BLK, 0, C.walk, 0, 0, 0);
        S.box.add(cx, 0, cz, 0, BLK + 0.08, 0.1, BLK + 0.08, 0, C.curb, 0, 0, 0);
        this.lamps(cx, cz, BLK, R);
        var kind;
        if (bi === 0 && bj === 0) kind = 'signature';
        else if (dist < 1.1) kind = ['tower', 'tower2', 'tower3'][(bi + 2 * bj + 9) % 3];
        else if (dist < 1.5) kind = R() < 0.5 ? 'mid' : 'park';
        else if (dist < 2.3) kind = R() < 0.2 ? 'park' : (R() < 0.75 ? 'mid' : 'tower3');
        else kind = R() < 0.3 ? 'park' : 'low';
        this[kind](cx, cz, BLK, R, delay);
      }
    }
    for (var key in S) { if (S[key].over && window.console) console.warn('city3d: batch ' + key + ' full'); S[key].upload(); }

    this.setupTraffic(R);
    this.setupDrones(R);
    void center;
  };

  City.prototype.tree = function (x, z, s, R, delay) {
    var S = this.S, seed = R(), leaf = [C.leaf1, C.leaf2, C.leaf3][Math.floor(R() * 3)];
    S.hex.add(x, 0.14, z, 0, 0.09 * s, 0.45 * s, 0.09 * s, 0, C.trunk, 0, 0, 0, delay);
    if (R() < 0.35) {
      S.cone.add(x, 0.4 * s, z, R() * 6, 0.62 * s, 1.15 * s, 0.62 * s, 0, leaf, 0, 2, seed, delay);
    } else {
      S.leaf.add(x, 0.36 * s, z, R() * 6, 0.78 * s, 0.82 * s, 0.78 * s, 0, leaf, 0, 2, seed, delay);
    }
  };

  City.prototype.lamps = function (cx, cz, B, R) {
    var S = this.S, e = B / 2 - 0.3;
    for (var s = -e + 0.6; s <= e; s += 2.6) {
      [[cx + s, cz - e], [cx + s, cz + e], [cx - e, cz + s], [cx + e, cz + s]].forEach(function (p) {
        S.hex.add(p[0], 0.14, p[1], 0, 0.05, 0.75, 0.05, 0, C.dark3, 0, 0, 0);
        S.box.add(p[0], 0.88, p[1], 0, 0.14, 0.06, 0.14, 0, C.yellowSoft, 1.6, 3, 0);
      });
    }
  };

  City.prototype.edgeTrees = function (cx, cz, B, R, delay, every) {
    var e = B / 2 - 0.75;
    for (var s = -e; s <= e + 0.01; s += every) {
      var pts = [[cx + s, cz - e], [cx + s, cz + e], [cx - e, cz + s], [cx + e, cz + s]];
      for (var i = 0; i < 4; i++) if (R() < 0.7) this.tree(pts[i][0], pts[i][1], 0.8 + R() * 0.35, R, delay + 0.4);
    }
  };

  // the tallest, twisting tower in the middle, with a spinning halo
  City.prototype.signature = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14, seed = R();
    S.box.add(cx, y, cz, 0, 5.2, 0.5, 5.2, 0, C.dark1, 0, 0, 0, delay);           // podium
    S.box.add(cx, y + 0.5, cz, 0, 4.4, 0.06, 4.4, 0, C.yellow, 1.2, 3, 0, delay);
    var floors = 24, h = 0.95;
    for (var i = 0; i < floors; i++) {
      var s = 3.3 - i * 0.045, yy = y + 0.56 + i * 1.0;
      S.box.add(cx, yy, cz, i * 0.1, s, h, s, 0, i % 6 === 5 ? C.dark2 : C.dark1, 0, 1, seed + i * 0.01, delay);
      S.box.add(cx, yy + h, cz, i * 0.1, s - 0.15, 0.05, s - 0.15, 0, C.yellow, 0.35, 3, 0, delay);
    }
    var top = y + 0.56 + floors;
    S.oct.add(cx, top, cz, 0, 1.4, 1.2, 1.4, 0, C.dark2, 0, 0, 0, delay);
    S.hex.add(cx, top + 1.2, cz, 0, 0.12, 5.0, 0.12, 0, C.dark3, 0, 0, 0, delay);
    S.box.add(cx, top + 6.2, cz, 0, 0.22, 0.22, 0.22, 0, C.yellow, 3.0, 4, seed, delay);
    S.ring.add(cx, top - 4.0, cz, 0, 5.6, 0.16, 5.6, 0.16, C.yellow, 1.6, 5, 0, delay, 0.35);
    S.ring.add(cx, top - 6.2, cz, 1.2, 4.9, 0.12, 4.9, -0.1, C.yellowSoft, 1.2, 5, 0, delay, -0.22);
    this.cornerTrees(cx, cz, B, R, delay);
  };

  City.prototype.cornerTrees = function (cx, cz, B, R, delay) {
    var e = B / 2 - 0.75;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
      this.tree(cx + c[0] * e, cz + c[1] * e, 0.9 + R() * 0.3, R, delay + 0.5);
      this.tree(cx + c[0] * (e - 0.9), cz + c[1] * e, 0.8 + R() * 0.3, R, delay + 0.5);
      this.tree(cx + c[0] * e, cz + c[1] * (e - 0.9), 0.8 + R() * 0.3, R, delay + 0.5);
    }, this);
  };

  // stacked octagon tower with glowing bands
  City.prototype.tower = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14, seed = R(), r = 4.0, hs = [6, 5, 4.5, 3.5], col = R() < 0.5 ? C.dark1 : C.dark2;
    var ox = (R() - 0.5) * 0.8, oz = (R() - 0.5) * 0.8;
    for (var i = 0; i < hs.length; i++) {
      S.oct.add(cx + ox, y, cz + oz, 0, r, hs[i], r, 0, col, 0, 1, seed + i, delay, 1);
      y += hs[i];
      S.oct.add(cx + ox, y, cz + oz, 0, r + 0.12, 0.12, r + 0.12, 0, C.yellow, 1.1, 3, 0, delay);
      y += 0.12; r -= 0.65;
    }
    S.hex.add(cx + ox, y, cz + oz, 0, 0.1, 3.2, 0.1, 0, C.dark3, 0, 0, 0, delay);
    S.box.add(cx + ox, y + 3.2, cz + oz, 0, 0.18, 0.18, 0.18, 0, C.yellow, 3.0, 4, seed, delay);
    this.cornerTrees(cx, cz, B, R, delay);
  };

  // Whiteout slab tower with vertical gardens
  City.prototype.tower2 = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14, seed = R(), w = 2.8, d = 2.2, h = 15 + R() * 4, rot = R() < 0.5 ? 0 : Math.PI / 2;
    S.box.add(cx, y, cz, rot, w + 1.2, 0.8, d + 1.6, 0, C.light2, 0, 1, seed, delay);
    S.box.add(cx, y + 0.8, cz, rot, w, h, d, 0, C.light1, 0, 1, seed + 0.5, delay);
    var c = Math.cos(rot), s = Math.sin(rot);
    for (var f = 1.6; f < h - 0.5; f += 1.35) {
      var side = (Math.round(f) % 2 ? 1 : -1);
      var lx = side * (w / 2 + 0.12), lz = 0;
      S.box.add(cx + c * lx + s * lz, y + 0.8 + f, cz - s * lx + c * lz, rot, 0.42, 0.45, d * 0.9, 0, [C.leaf1, C.leaf2, C.leaf3][Math.floor(R() * 3)], 0, 0, 0, delay);
    }
    S.box.add(cx, y + 0.8 + h, cz, rot, w - 0.3, 0.25, d - 0.3, 0, C.grass, 0, 0, 0, delay);
    for (var t = 0; t < 3; t++) S.leaf.add(cx + (R() - 0.5) * 1.4, y + 1.05 + h, cz + (R() - 0.5) * 1.0, 0, 0.6, 0.6, 0.6, 0, C.leaf1, 0, 2, R(), delay);
    S.box.add(cx, y + 0.8 + h - 0.05, cz, rot, w + 0.06, 0.08, d + 0.06, 0, C.yellow, 1.0, 3, 0, delay);
    this.cornerTrees(cx, cz, B, R, delay);
  };

  // cylinder tower with a yellow crown
  City.prototype.tower3 = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14, seed = R(), h = 10 + R() * 5, r = 2.6 + R() * 0.6;
    S.cyl.add(cx, y, cz, 0, r, h, r, 0, R() < 0.5 ? C.dark1 : C.dark2, 0, 1, seed, delay, 1);
    S.cyl.add(cx, y + h, cz, 0, r + 0.1, 0.1, r + 0.1, 0, C.yellow, 1.2, 3, 0, delay);
    S.cone.add(cx, y + h + 0.1, cz, 0, r * 0.8, 1.6, r * 0.8, 0, C.dark3, 0, 0, 0, delay);
    S.ring.add(cx, y + h * 0.62, cz, R() * 6, r + 0.9, 0.12, r + 0.9, 0.08, C.yellowSoft, 1.0, 5, 0, delay, 0.28);
    // two low pavilions beside it
    S.box.add(cx - 2.2, y, cz + 2.2, 0, 1.6, 1.2, 1.6, 0, C.light2, 0, 1, seed + 3, delay);
    S.box.add(cx + 2.2, y, cz - 2.2, 0, 1.6, 0.9, 1.6, 0, C.light1, 0, 1, seed + 4, delay);
    this.edgeTrees(cx, cz, B, R, delay, 2.2);
  };

  // 2 x 2 mid-rise lots
  City.prototype.mid = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
      var x = cx + q[0] * 1.65, z = cz + q[1] * 1.65, w = 2.2 + R() * 0.6, d = 2.2 + R() * 0.6, h = 2.5 + R() * 6;
      var light = R() < 0.55, col = light ? (R() < 0.5 ? C.light1 : C.light2) : (R() < 0.5 ? C.dark1 : C.dark2);
      S.box.add(x, y, z, 0, w, h, d, 0, col, 0, 1, R(), delay);
      if (R() < 0.5) {   // setback
        S.box.add(x, y + h, z, 0, w * 0.6, 1.2 + R() * 2, d * 0.6, 0, col, 0, 1, R(), delay);
      } else if (R() < 0.5) { // roof garden
        S.box.add(x, y + h, z, 0, w - 0.3, 0.12, d - 0.3, 0, C.grass, 0, 0, 0, delay);
        S.leaf.add(x, y + h + 0.1, z, 0, 0.7, 0.65, 0.7, 0, C.leaf3, 0, 2, R(), delay);
      } else {           // solar
        S.box.add(x, y + h + 0.15, z, 0, w - 0.5, 0.05, d - 0.5, 0.25, C.solar, 0, 0, 0, delay);
      }
      if (R() < 0.35) S.box.add(x, y + h - 0.04, z, 0, w + 0.04, 0.05, d + 0.04, 0, C.yellow, 0.8, 3, 0, delay);
    });
    this.edgeTrees(cx, cz, B, R, delay, 3.2);
  };

  // 2 x 3 low-rise shops and homes
  City.prototype.low = function (cx, cz, B, R, delay) {
    var S = this.S, y = 0.14;
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j += 2) {
      if (R() < 0.15) { this.tree(cx + i * 2.0, cz + j * 1.5, 1, R, delay); continue; }
      var x = cx + i * 2.0, z = cz + j * 1.5, w = 1.5 + R() * 0.3, d = 2.0 + R() * 0.4, h = 0.9 + R() * 1.8;
      var col = R() < 0.6 ? (R() < 0.5 ? C.light1 : C.light2) : C.dark2;
      S.box.add(x, y, z, 0, w, h, d, 0, col, 0, 1, R(), delay);
      if (R() < 0.35) S.box.add(x, y + 0.55, z + j * (d / 2 + 0.12), 0, w * 0.8, 0.05, 0.3, 0, C.yellow, 0.25, 0, 0, delay); // awning
      if (R() < 0.4) S.box.add(x, y + h, z, 0, w - 0.3, 0.1, d - 0.3, 0, C.grass, 0, 0, 0, delay);
      else S.box.add(x + 0.2, y + h, z - 0.2, 0, 0.4, 0.3, 0.4, 0, C.dark3, 0, 0, 0, delay);
    }
    this.edgeTrees(cx, cz, B, R, delay, 3.0);
  };

  City.prototype.park = function (cx, cz, B, R, delay) {
    var S = this.S;
    S.box.add(cx, 0.14, cz, 0, B - 0.9, 0.06, B - 0.9, 0, C.grass, 0, 0, 0);
    S.box.add(cx, 0.15, cz, 0, B - 0.9, 0.06, 0.7, 0, C.walk, 0, 0, 0);
    S.box.add(cx, 0.15, cz, 0, 0.7, 0.06, B - 0.9, 0, C.walk, 0, 0, 0);
    S.cyl.add(cx, 0.2, cz, 0, 1.6, 0.25, 1.6, 0, C.dark2, 0, 0, 0);
    S.cyl.add(cx, 0.45, cz, 0, 0.9, 0.08, 0.9, 0, C.yellowSoft, 0.8, 3, 0);
    for (var n = 0; n < 16; n++) {
      var x = cx + (R() - 0.5) * (B - 1.6), z = cz + (R() - 0.5) * (B - 1.6);
      if (Math.abs(x - cx) < 0.7 || Math.abs(z - cz) < 0.7) continue;
      this.tree(x, z, 0.8 + R() * 0.6, R, delay);
    }
  };

  /* ---------- traffic ---------- */
  City.prototype.setupTraffic = function (R) {
    var lanes = [], roads = this.roads, E = this.E, ROAD = this.ROAD;
    var self = this;
    roads.forEach(function (r, ri) {
      if (Math.abs(r) > self.rad + 4) return;
      [1, -1].forEach(function (dir) {
        lanes.push({ axis: 'x', fixed: r + dir * 0.45, dir: dir, cars: [], ri: ri });
        lanes.push({ axis: 'z', fixed: r - dir * 0.45, dir: dir, cars: [], ri: ri });
      });
    });
    var palette = [C.light1, C.light1, C.dark2, C.light2, C.yellow, C.dark3, C.orange];
    lanes.forEach(function (ln) {
      var n = 1 + Math.floor(R() * 3), placed = [];
      for (var i = 0; i < n * 4 && placed.length < n; i++) {
        var s = -E + R() * 2 * E;
        if (roads.some(function (q) { return Math.abs(q * ln.dir - s) < ROAD / 2 + 1.2; })) continue;
        if (placed.some(function (p) { return Math.abs(p - s) < 3; })) continue;
        placed.push(s);
        ln.cars.push({ s: s, v: 0, vmax: 2.2 + R() * 1.0, col: palette[Math.floor(R() * palette.length)] });
      }
    });
    this.lanes = lanes;
  };
  City.prototype.light = function (axis, ix) {
    // 12 s cycle per crossing, offset per road -> a gentle green wave
    var t = (this.t + ix * 1.7) % 12;
    if (axis === 'x') return t < 4.6;
    return t >= 6 && t < 10.6;
  };
  City.prototype.updateTraffic = function (dt) {
    var E = this.E, L = 2 * E, roads = this.roads, ROAD = this.ROAD, self = this;
    this.lanes.forEach(function (ln) {
      var cars = ln.cars;
      cars.sort(function (a, b) { return a.s - b.s; });
      for (var i = cars.length - 1; i >= 0; i--) {
        var c = cars[i], target = c.vmax;
        if (cars.length > 1) {
          var lead = i === cars.length - 1 ? cars[0] : cars[i + 1];
          var gap = lead.s - c.s; if (gap <= 0) gap += L;
          if (gap < 1.3) target = 0; else if (gap < 3) target = Math.min(target, c.vmax * (gap - 1.3) / 1.7);
        }
        // nearest stop line ahead
        for (var k = 0; k < roads.length; k++) {
          var cross = roads[k] * ln.dir;          // crossing position in lane coordinates
          var stop = cross - ROAD / 2 - 0.55;
          var d = stop - c.s;
          if (d >= -0.05 && d < 4) {
            if (!self.light(ln.axis, k + ln.ri) && !(d < 0.45 && c.v > 1.2)) {
              target = Math.min(target, d < 0.06 ? 0 : c.vmax * Math.min(1, d / 3));
            }
            break;
          }
        }
        var dv = target - c.v;
        c.v += dv > 0 ? Math.min(dv, 1.8 * dt) : Math.max(dv, -7 * dt);
        if (c.v < 0) c.v = 0;
        c.s += c.v * dt;
        if (c.s > E) c.s -= L;
      }
    });
  };
  City.prototype.writeCars = function () {
    var D = this.dyn;
    this.lanes.forEach(function (ln) {
      ln.cars.forEach(function (c) {
        var w = c.s * ln.dir, x, z, ry;
        if (ln.axis === 'x') { x = w; z = ln.fixed; ry = ln.dir > 0 ? 0 : Math.PI; }
        else { x = ln.fixed; z = w; ry = ln.dir > 0 ? -Math.PI / 2 : Math.PI / 2; }
        var cs = Math.cos(ry), sn = Math.sin(ry);
        var at = function (lx, lz) { return [x + cs * lx + sn * lz, z - sn * lx + cs * lz]; };
        D.add(x, 0.02, z, ry, 0.62, 0.16, 0.3, 0, c.col, 0, 0, 0);
        var cab = at(-0.04, 0);
        D.add(cab[0], 0.18, cab[1], ry, 0.34, 0.11, 0.26, 0, C.glass, 0, 0, 0);
        var h1 = at(0.31, 0.09), h2 = at(0.31, -0.09), t1 = at(-0.31, 0.09), t2 = at(-0.31, -0.09);
        D.add(h1[0], 0.07, h1[1], ry, 0.03, 0.05, 0.07, 0, C.yellowSoft, 3.2, 3, 0);
        D.add(h2[0], 0.07, h2[1], ry, 0.03, 0.05, 0.07, 0, C.yellowSoft, 3.2, 3, 0);
        D.add(t1[0], 0.07, t1[1], ry, 0.03, 0.05, 0.07, 0, C.tail, 1.6, 3, 0);
        D.add(t2[0], 0.07, t2[1], ry, 0.03, 0.05, 0.07, 0, C.tail, 1.6, 3, 0);
      });
    });
  };

  /* ---------- drones ---------- */
  City.prototype.setupDrones = function (R) {
    var d = [];
    for (var i = 0; i < this.cfg.drones; i++) {
      d.push({ cx: (R() - 0.5) * this.rad, cz: (R() - 0.5) * this.rad, r: 5 + R() * 9, y: 9 + R() * 9, sp: (0.08 + R() * 0.1) * (R() < 0.5 ? -1 : 1), ph: R() * 6.28, b: R() * 6.28 });
    }
    this.drones = d;
  };
  City.prototype.writeDrones = function () {
    var D = this.dyn, t = this.t;
    this.drones.forEach(function (q) {
      var a = q.ph + t * q.sp, x = q.cx + Math.cos(a) * q.r, z = q.cz + Math.sin(a) * q.r, y = q.y + Math.sin(t * 0.9 + q.b) * 0.35;
      var ry = -a + (q.sp > 0 ? 0 : Math.PI);
      D.add(x, y, z, ry, 0.55, 0.12, 0.32, 0, C.dark3, 0, 0, 0);
      D.add(x, y + 0.12, z, ry, 0.3, 0.06, 0.2, 0, C.light1, 0, 0, 0);
      D.add(x, y - 0.03, z, ry, 0.42, 0.03, 0.22, 0, C.yellow, 2.4, 3, 0);
    });
  };

  /* ---------- Message Automation Hub (contact section) ----------
   * inbox icons -> conveyor through Trigger / Filter / Action nodes ->
   * AI core -> paper-plane replies -> laptop & phone light up with a check.
   */
  var HUB = { INT: 1.5, DROP: 0.7, BELT: 3.6, LIFT: 0.8, PROC: 0.5, FLY: 2.2, SHOW: 1.3 };
  HUB.LIFE = HUB.DROP + HUB.BELT + HUB.LIFT + HUB.PROC + HUB.FLY + HUB.SHOW;

  City.prototype.buildHub = function (R) {
    var S = this.S, Y0 = 0.4;
    this.rad = 19; this.flow = -1.4;
    var H = this.hub = {
      Y0: Y0, inbox: -7.0, zs: [-2.2, 0, 2.2], bs: -5.4, be: -0.4, beltY: Y0 + 0.53,
      gates: [-4.3, -2.9, -1.5], core: [2.3, Y0 + 2.75, 0],
      dev: [{ x: 6.3, z: 1.6, yaw: -0.38, kind: 'laptop' }, { x: 6.4, z: -1.8, yaw: -0.55, kind: 'phone' }]
    };
    function dl(x) { return 0.1 + (x + 9) * 0.05; }
    var o0 = [0, 0, 0];

    // ground, platform, glowing rim, subtle grid
    S.box.add(0, -0.2, 0, 0, 300, 0.2, 300, 0, C.floor, 0, 0, 0);
    S.box.add(0, 0, 0, 0, 17.4, Y0, 9.2, 0, C.dark1, 0, 0, 0, 0.05);
    S.box.add(0, Y0 - 0.07, 0, 0, 17.52, 0.05, 9.32, 0, C.yellow, 0.7, 3, 0, 0.05);
    for (var gx = -7.5; gx <= 7.51; gx += 1.5) S.box.add(gx, Y0, 0, 0, 0.025, 0.006, 9.0, 0, C.dark2, 0, 0, 0, 0.05);
    for (var gz = -4.5; gz <= 4.51; gz += 1.5) S.box.add(0, Y0, gz, 0, 17.0, 0.006, 0.025, 0, C.dark2, 0, 0, 0, 0.05);

    // inbox pedestals + cables to the belt
    H.zs.forEach(function (z) {
      var d = dl(H.inbox);
      S.cyl.add(H.inbox, Y0, z, 0, 1.5, 0.12, 1.5, 0, C.dark2, 0, 0, 0, d);
      S.cyl.add(H.inbox, Y0 + 0.12, z, 0, 1.2, 0.7, 1.2, 0, C.dark3, 0, 0, 0, d);
      S.cyl.add(H.inbox, Y0 + 0.74, z, 0, 1.27, 0.05, 1.27, 0, C.yellow, 1.0, 3, 0, d);
      var a = [H.inbox + 0.65, z], b = [H.bs - 0.35, 0], v = [b[0] - a[0], 0, b[1] - a[1]], L = Math.hypot(v[0], v[2]);
      S.box.add((a[0] + b[0]) / 2, Y0, (a[1] + b[1]) / 2, Math.atan2(v[0], v[2]), 0.07, 0.015, L, 0, C.yellow, 0.35, 3, 0, d);
    });

    // conveyor
    var bl = H.be - H.bs + 0.8, bc = (H.bs + H.be) / 2, d0 = dl(-4);
    S.box.add(bc, Y0, 0, 0, bl, 0.45, 1.3, 0, C.dark2, 0, 0, 0, d0);
    S.box.add(bc, Y0 + 0.45, 0, 0, bl - 0.1, 0.08, 1.0, 0, C.belt, 0, 0, 0, d0);
    S.box.add(bc, Y0 + 0.45, 0.6, 0, bl, 0.14, 0.09, 0, C.light2, 0, 0, 0, d0);
    S.box.add(bc, Y0 + 0.45, -0.6, 0, bl, 0.14, 0.09, 0, C.light2, 0, 0, 0, d0);
    [H.bs - 0.35, H.be + 0.35].forEach(function (x) { S.cyl.add(x, Y0 + 0.3, -0.55, 0, 0.42, 1.1, 0.42, Math.PI / 2, C.dark3, 0, 0, 0, d0); });
    for (var lx = H.bs + 0.2; lx < H.be; lx += 1.2) {           // little legs
      S.box.add(lx, Y0, 0.66, 0, 0.12, 0.45, 0.06, 0, C.dark3, 0, 0, 0, d0);
      S.box.add(lx, Y0, -0.66, 0, 0.12, 0.45, 0.06, 0, C.dark3, 0, 0, 0, d0);
    }

    // node gates: Trigger (spike), Filter (funnel), Action (cube)
    H.gates.forEach(function (x, i) {
      var d = dl(x);
      S.box.add(x, Y0, 0.86, 0, 0.24, 1.62, 0.24, 0, C.dark1, 0, 0, 0, d);
      S.box.add(x, Y0, -0.86, 0, 0.24, 1.62, 0.24, 0, C.dark1, 0, 0, 0, d);
      S.box.add(x, Y0 + 1.62, 0, 0, 0.42, 0.26, 1.98, 0, C.dark2, 0, 0, 0, d);
      S.box.add(x, Y0 + 1.88, 0, 0, 0.7, 0.1, 0.7, 0, C.dark3, 0, 0, 0, d);
      if (i === 0) S.cone.add(x, Y0 + 1.98, 0, 0, 0.46, 0.62, 0.46, 0, C.light1, 0, 0, 0, d);
      else if (i === 1) S.cone.add(x, Y0 + 2.6, 0.0, 0, 0.6, 0.62, 0.6, Math.PI, C.light1, 0, 0, 0, d);
      else S.box.add(x, Y0 + 1.98, 0, Math.PI / 4, 0.42, 0.42, 0.42, 0, C.light1, 0, 0, 0, d);
    });

    // AI core pedestal + gyroscope rings + server racks
    var c = H.core, dc = dl(c[0]);
    S.cyl.add(c[0], Y0, c[2], 0, 3.3, 0.55, 3.3, 0, C.dark2, 0, 0, 0, dc);
    S.cyl.add(c[0], Y0 + 0.47, c[2], 0, 3.36, 0.05, 3.36, 0, C.yellow, 1.0, 3, 0, dc);
    S.cyl.add(c[0], Y0 + 0.55, c[2], 0, 1.7, 0.32, 1.7, 0, C.dark3, 0, 0, 0, dc);
    S.cyl.add(c[0], Y0 + 0.87, c[2], 0, 0.9, 0.03, 0.9, 0, C.yellowSoft, 0.8, 3, 0, dc);
    S.ring.add(c[0], c[1] - 0.06, c[2], 0, 3.0, 0.12, 3.0, 0.55, C.yellowSoft, 0.9, 5, 0, dc, 0.5);
    S.ring.add(c[0], c[1] - 0.06, c[2], 1.0, 3.7, 0.12, 3.7, -0.8, C.yellow, 0.6, 5, 0, dc, -0.34);
    S.ring.add(c[0], c[1] - 0.06, c[2], 2.0, 4.4, 0.1, 4.4, 1.25, C.light1, 0.3, 5, 0, dc, 0.22);
    [[0.3, -3.5], [1.4, -3.5], [3.2, -3.5], [4.3, -3.5]].forEach(function (p, i) {
      S.box.add(p[0], Y0, p[1], 0, 1.0, 1.6 + (i % 2) * 0.5, 0.8, 0, C.dark1, 0, 1, R(), dl(p[0]));
      S.box.add(p[0], Y0 + 1.6 + (i % 2) * 0.5, p[1], 0, 1.04, 0.05, 0.84, 0, C.yellow, 0.6, 3, 0, dl(p[0]));
    });

    // device pedestals, laptop and phone bodies
    H.dev.forEach(function (dv) {
      var d = dl(dv.x), o = [dv.x, Y0, dv.z];
      put(S.box, o, dv.yaw, 0, [0, 0, 0], [2.7, 0.32, 2.2], C.dark2, 0, 0, 0, d);
      put(S.box, o, dv.yaw, 0, [0, 0.27, 0], [2.78, 0.04, 2.28], C.yellow, 0.6, 3, 0, d);
      var top = [dv.x, Y0 + 0.32, dv.z];
      if (dv.kind === 'laptop') {
        put(S.box, top, dv.yaw, 0, [0, 0, 0.1], [1.8, 0.08, 1.2], C.light2, 0, 0, 0, d);
        put(S.box, top, dv.yaw, 0, [0, 0.08, 0.22], [1.5, 0.012, 0.62], C.dark2, 0, 0, 0, d);
        var h = xf(dv.yaw, 0, 0, 0.08, -0.48);
        dv.hinge = [top[0] + h[0], top[1] + h[1], top[2] + h[2]]; dv.tilt = -0.24; dv.panel = [1.56, 1.0]; dv.body = [1.8, 1.16, 0.06];
      } else {
        put(S.box, top, dv.yaw, 0, [0, 0, -0.05], [0.9, 0.12, 0.7], C.dark3, 0, 0, 0, d);
        var hp = xf(dv.yaw, 0, 0, 0.12, -0.1);
        dv.hinge = [top[0] + hp[0], top[1] + hp[1], top[2] + hp[2]]; dv.tilt = -0.3; dv.panel = [0.56, 1.16]; dv.body = [0.68, 1.32, 0.08];
      }
      put(S.box, dv.hinge, dv.yaw, dv.tilt, [0, 0, -0.03], dv.body, dv.kind === 'laptop' ? C.light2 : C.dark2, 0, 0, 0, d);
      var sc = xf(dv.yaw, dv.tilt, 0, (dv.body[1]) / 2, 0.12);
      dv.screen = [dv.hinge[0] + sc[0], dv.hinge[1] + sc[1], dv.hinge[2] + sc[2]];
      dv.delay = d; dv.flash = 0;
    });

    // plants on the platform corners
    var self = this;
    [[-7.9, 3.7], [-3.4, 3.6], [3.7, 3.7], [7.9, -3.7], [-7.9, -3.7]].forEach(function (p) {
      var d = dl(p[0]) + 0.3;
      S.cyl.add(p[0], Y0, p[1], 0, 0.55, 0.42, 0.55, 0, C.light2, 0, 0, 0, d);
      S.leaf.add(p[0], Y0 + 0.36, p[1], R() * 6, 0.9, 0.95, 0.9, 0, [C.leaf1, C.leaf2, C.leaf3][Math.floor(R() * 3)], 0, 2, R(), d);
      if (R() < 0.6) S.cone.add(p[0] + 0.1, Y0 + 0.9, p[1], 0, 0.5, 0.8, 0.5, 0, C.leaf2, 0, 2, R(), d);
    });
    void self; void o0;
  };

  // message shapes, lying flat (envelope / chat bubble / form)
  City.prototype.drawMsg = function (type, o, yaw, s, rise) {
    var D = this.D;
    if (s <= 0.001) return;
    if (type === 0) {
      put(D.box, o, yaw, 0, [0, 0, 0], [0.62 * s, 0.06 * s, 0.42 * s], C.light1, 0, 0, 0, rise);
      put(D.box, o, yaw, 0, [-0.15 * s, 0.06 * s, -0.06 * s], [0.36 * s, 0.012 * s, 0.026 * s], C.dark3, 0, 0, 0, rise, 0, 0.6);
      put(D.box, o, yaw, 0, [0.15 * s, 0.06 * s, -0.06 * s], [0.36 * s, 0.012 * s, 0.026 * s], C.dark3, 0, 0, 0, rise, 0, -0.6);
      put(D.box, o, yaw, 0, [0, 0.06 * s, 0.03 * s], [0.12 * s, 0.016 * s, 0.12 * s], C.yellow, 0.8, 3, 0, rise, 0, Math.PI / 4);
    } else if (type === 1) {
      put(D.cyl, o, yaw, 0, [0, 0, 0], [0.64 * s, 0.08 * s, 0.5 * s], C.yellow, 0.12, 0, 0, rise);
      put(D.box, o, yaw, 0, [-0.22 * s, 0, 0.2 * s], [0.16 * s, 0.08 * s, 0.16 * s], C.yellow, 0.12, 0, 0, rise, 0, 0.7);
      for (var k = -1; k <= 1; k++) put(D.box, o, yaw, 0, [k * 0.14 * s, 0.08 * s, 0], [0.07 * s, 0.02 * s, 0.07 * s], C.dark1, 0, 0, 0, rise);
    } else {
      put(D.box, o, yaw, 0, [0, 0, 0], [0.46 * s, 0.05 * s, 0.6 * s], C.light2, 0, 0, 0, rise);
      for (var j = -1; j <= 1; j++) put(D.box, o, yaw, 0, [-0.03 * s, 0.05 * s, j * 0.14 * s], [(j ? 0.3 : 0.22) * s, 0.012 * s, 0.03 * s], C.dark3, 0, 0, 0, rise);
      put(D.box, o, yaw, 0, [0.15 * s, 0.05 * s, -0.22 * s], [0.12 * s, 0.014 * s, 0.12 * s], C.yellow, 0.7, 3, 0, rise);
    }
  };

  City.prototype.writeHub = function (dt) {
    var H = this.hub, D = this.D, t = this.t, Y0 = H.Y0, c = H.core;
    if (this.started) this.flow += dt;
    var f = this.flow, i, k;
    var speed = (H.be - H.bs) / HUB.BELT;
    var gate = [0, 0, 0], pulse = 0;
    H.dev[0].flash = 0; H.dev[1].flash = 0; H.dev[0].chk = -1; H.dev[1].chk = -1;
    var ease = function (u) { return u * u * (3 - 2 * u); };

    // inbox icons floating & spinning above their pedestals
    H.zs.forEach(function (z, ty) {
      this.drawMsg(ty, [H.inbox, Y0 + 1.3 + Math.sin(t * 1.4 + ty * 2) * 0.08, z], t * 0.5 + ty * 2.1, 1.45, 0.1 + (H.inbox + 9) * 0.05);
      var u = (t * 0.45 + ty * 0.33) % 1, a = [H.inbox + 0.65, z], b = [H.bs - 0.35, 0];   // cable pulses
      D.box.add(a[0] + (b[0] - a[0]) * u, Y0, a[1] + (b[1] - a[1]) * u, 0, 0.14, 0.035, 0.14, 0, C.yellow, 2.4, 3, 0);
    }, this);

    // belt chevrons
    var bl = H.be - H.bs;
    for (k = 0; k < 8; k++) {
      var cx = H.bs + ((k * bl / 8 + Math.max(f, 0) * speed) % bl);
      D.box.add(cx, H.beltY, 0, 0, 0.1, 0.008, 0.62, 0, C.yellow, 0.4, 3, 0);
    }

    // messages
    var first = Math.floor((f - HUB.LIFE) / HUB.INT), last = Math.floor(f / HUB.INT);
    for (i = Math.max(0, first); i <= last; i++) {
      var tt = f - i * HUB.INT, type = i % 3, dv = H.dev[i % 2];
      if (tt < 0 || tt > HUB.LIFE) continue;
      if (tt < HUB.DROP) {                                  // pop out of the inbox, hop onto the belt
        var u = tt / HUB.DROP, z0 = H.zs[type];
        var p = [H.inbox + (H.bs - H.inbox) * u, Y0 + 1.25 + (H.beltY - Y0 - 1.25) * u + Math.sin(Math.PI * u) * 1.1, z0 * (1 - u)];
        this.drawMsg(type, p, t * 0.5 + type * 2.1 + u * 2, 1.0 * Math.min(1, tt / 0.18), -100);
        continue;
      }
      tt -= HUB.DROP;
      if (tt < HUB.BELT) {                                  // ride through the three nodes
        var x = H.bs + speed * tt;
        this.drawMsg(type, [x, H.beltY + 0.005, 0], 0, 1.0, -100);
        H.gates.forEach(function (g, gi) { gate[gi] = Math.max(gate[gi], Math.exp(-Math.pow((x - g) / 0.42, 2))); });
        continue;
      }
      tt -= HUB.BELT;
      if (tt < HUB.LIFT) {                                  // lifted into the AI core
        var w = ease(tt / HUB.LIFT);
        var q = [H.be + (c[0] - H.be) * w, H.beltY + (c[1] - H.beltY) * w + Math.sin(Math.PI * w) * 1.2, 0];
        this.drawMsg(type, q, w * 3, 1.0 * Math.pow(1 - w, 0.6), -100);
        if (w > 0.75) pulse = Math.max(pulse, (w - 0.75) * 4);
        continue;
      }
      tt -= HUB.LIFT;
      if (tt < HUB.PROC) { pulse = Math.max(pulse, Math.sin(Math.PI * tt / HUB.PROC) * 0.6 + 0.4); continue; }
      tt -= HUB.PROC;
      if (tt < HUB.FLY) {                                   // reply flies out as a paper plane
        var s = tt / HUB.FLY, P0 = [c[0] + 0.9, c[1] + 0.2, c[2] + (dv.z > 0 ? 0.3 : -0.3)];
        var n = xf(dv.yaw, dv.tilt, 0, 0, 1), P3 = [dv.screen[0] + n[0] * 0.25, dv.screen[1] + n[1] * 0.25, dv.screen[2] + n[2] * 0.25];
        var P1 = [P0[0] + 1.4, P0[1] + 2.0, P0[2]], P2 = [P3[0] + n[0] * 2.2 - 0.6, P3[1] + 1.6, P3[2] + n[2] * 2.2];
        var bz = function (u2) {
          var a1 = 1 - u2;
          return [0, 1, 2].map(function (j) { return a1 * a1 * a1 * P0[j] + 3 * a1 * a1 * u2 * P1[j] + 3 * a1 * u2 * u2 * P2[j] + u2 * u2 * u2 * P3[j]; });
        };
        var e = ease(s), pos = bz(e), ahead = bz(Math.min(1, e + 0.02)), back = bz(Math.max(0, e - 0.02));
        var dir = [ahead[0] - back[0], ahead[1] - back[1], ahead[2] - back[2]], or = orient(dir);
        var sc = 1.0 * Math.min(1, s / 0.12) * (s > 0.88 ? (1 - s) / 0.12 : 1);
        D.plane.add(pos[0], pos[1], pos[2], or[0], sc, sc, sc, or[1], C.light1, 0.15, 0, 0);
        for (k = 1; k <= 4; k++) {
          var tp = bz(Math.max(0, e - k * 0.035)), ts = 0.09 * (1 - k / 5) * Math.min(1, s / 0.12);
          if (ts > 0.005) D.box.add(tp[0], tp[1] - ts / 2, tp[2], 0, ts, ts, ts, 0, C.yellow, 2.2, 3, 0);
        }
        continue;
      }
      tt -= HUB.FLY;
      dv.flash = Math.max(dv.flash, Math.exp(-tt * 2.2)); dv.chk = Math.max(dv.chk, tt);
    }

    // gates light up as a message passes
    H.gates.forEach(function (g, gi) {
      var em = 0.25 + 2.6 * gate[gi], d = 0.1 + (g + 9) * 0.05;
      D.box.add(g, Y0 + 1.55, 0, 0, 0.3, 0.06, 1.5, 0, C.yellow, em, 3, 0, d);
      D.box.add(g, H.beltY + 0.002, 0, 0, 0.07, 0.006, 0.95, 0, C.yellow, 0.2 + 2.2 * gate[gi], 3, 0, d);
      D.box.add(g + 0.22, Y0 + 1.68, 0, 0, 0.03, 0.1, 0.5, 0, C.yellowSoft, 0.4 + 3 * gate[gi], 3, 0, d);
    });

    // AI core with a neural shell
    var dc = 0.1 + (c[0] + 9) * 0.05;
    var cs = 1.45 * (1 + 0.05 * Math.sin(t * 2.1) + 0.16 * pulse);
    D.sph.add(c[0], c[1] - cs / 2, c[2], t * 0.3, cs, cs, cs, 0, C.yellowSoft, 0.75 + 1.6 * pulse, 3, 0, dc);
    var NN = 9, rot = t * 0.22;
    for (k = 0; k < NN; k++) {
      var yy = 1 - (k + 0.5) / NN * 2, rr = Math.sqrt(1 - yy * yy), th = k * 2.39996 + rot;
      var R2 = 2.05 + 0.1 * Math.sin(t * 1.3 + k);
      var nd = [Math.cos(th) * rr, yy * 0.8, Math.sin(th) * rr];
      var np = [c[0] + nd[0] * R2, c[1] + nd[1] * R2, c[2] + nd[2] * R2];
      var cp = [c[0] + nd[0] * 0.8, c[1] + nd[1] * 0.8, c[2] + nd[2] * 0.8];
      var bv = [np[0] - cp[0], np[1] - cp[1], np[2] - cp[2]], bo = orient(bv), L = Math.hypot(bv[0], bv[1], bv[2]);
      D.sph.add(np[0], np[1] - 0.12, np[2], 0, 0.24, 0.24, 0.24, 0, C.light1, 0.35 + pulse * 0.8, 3, 0, dc);
      D.box.add((np[0] + cp[0]) / 2, (np[1] + cp[1]) / 2, (np[2] + cp[2]) / 2, bo[0], 0.035, 0.035, L, bo[1], C.yellowSoft, 0.7, 3, 0, dc);
      var pu = (t * 0.7 + k * 0.137) % 1;
      D.box.add(np[0] + (cp[0] - np[0]) * pu, np[1] + (cp[1] - np[1]) * pu - 0.045, np[2] + (cp[2] - np[2]) * pu, 0, 0.09, 0.09, 0.09, 0, C.yellow, 2.6, 3, 0, dc);
    }

    // device screens + check marks
    H.dev.forEach(function (dv) {
      var em = 0.35 + 1.9 * dv.flash;
      put(D.box, dv.hinge, dv.yaw, dv.tilt, [0, (dv.body[1] - dv.panel[1]) / 2, 0.012], [dv.panel[0], dv.panel[1], 0.012], C.screen, em, 3, 0, dv.delay);
      var rows = dv.kind === 'laptop' ? [0.72, 0.56, 0.4, 0.24] : [0.82, 0.68, 0.54, 0.4, 0.26];
      rows.forEach(function (ry, ri) {
        var w = dv.panel[0] * (ri % 2 ? 0.55 : 0.78);
        put(D.box, dv.hinge, dv.yaw, dv.tilt, [-(dv.panel[0] - w) / 2 + dv.panel[0] * 0.06, dv.body[1] * ry, 0.026], [w, 0.05, 0.006], C.dark3, 0, 0, 0, dv.delay);
      });
      if (dv.chk >= 0 && dv.chk < HUB.SHOW) {
        var u = dv.chk / 0.35, sc = u < 1 ? 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2) : 1;
        if (dv.chk > HUB.SHOW - 0.3) sc *= (HUB.SHOW - dv.chk) / 0.3;
        sc = Math.max(0, sc) * (dv.kind === 'laptop' ? 0.9 : 0.7);
        D.check.add(dv.screen[0], dv.screen[1] + (dv.kind === 'laptop' ? 1.05 : 1.2), dv.screen[2], this.camAz || 0, sc, sc, sc, 0, C.yellow, 2.2, 3, 0);
      }
    }, this);
  };

  /* ---------- frame ---------- */
  City.prototype.resize = function () {
    var r = this.host.getBoundingClientRect(), dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, r.width < 820 ? 1.5 : 1.75) * QUALITY.scale);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.cssW = r.width; this.cssH = r.height;
  };

  City.prototype.camera = function () {
    var cfg = this.cfg, asp = this.canvas.width / this.canvas.height, narrow = this.cssW < 820;
    // On desktop the scene is framed against the 1360px content column, not the
    // whole viewport, so text and model stay together on wide or zoomed-out screens.
    var colW = Math.min(this.cssW, 1360), colL = (this.cssW - colW) / 2, aspCol = colW / Math.max(1, this.cssH);
    var t = this.t, motion = !REDUCE;
    var az = cfg.az + (motion ? Math.sin(t * 0.11) * 0.2 + this.mx * 0.08 : 0);
    var el = cfg.el + (motion ? Math.sin(t * 0.07) * 0.03 - this.my * 0.03 : 0);
    var fov = cfg.fov * Math.PI / 180;
    var dist, oy, cityPx = Math.min(this.cssW, 540), span = cfg.span || 46, lift = cfg.mLift || 0.42;
    if (narrow) {
      // keep the city a fixed on-screen size and park it at the bottom of the section
      dist = (span / cityPx) * this.cssH / (2 * Math.tan(fov / 2));
      oy = 1 - 2 * (this.cssH - lift * cityPx - cfg.mBottom) / this.cssH;
    } else {
      dist = cfg.fitW ? Math.max(cfg.fit / Math.tan(fov / 2), cfg.fitW / (Math.tan(fov / 2) * aspCol))
                      : cfg.fit / Math.tan(fov / 2) / Math.min(1, aspCol * 0.9);
      oy = cfg.offY;
    }
    var ty = cfg.ty == null ? 4 : cfg.ty;
    var tgt = [0, ty + (motion ? this.scroll * (cfg.kind === 'hub' ? 1.2 : 3) : 0), 0];
    this.camAz = az;
    var eye = [tgt[0] + Math.cos(el) * Math.sin(az) * dist, tgt[1] + Math.sin(el) * dist, tgt[2] + Math.cos(el) * Math.cos(az) * dist];
    var P = persp(fov, asp, 1, dist * 3);
    var ox = narrow ? 0 : 2 * (colL + cfg.cx * colW) / this.cssW - 1;
    for (var c = 0; c < 4; c++) { P[c * 4] += ox * P[c * 4 + 3]; P[c * 4 + 1] += oy * P[c * 4 + 3]; }
    this.eye = eye;
    return mul(P, lookAt(eye, tgt, [0, 1, 0]));
  };

  City.prototype.frame = function (dt) {
    if (this.dead) return;
    var gl = this.gl;
    this.t += dt;
    if (this.started && !REDUCE) this.riseT += dt;
    this.mx += (this.tmx - this.mx) * Math.min(1, dt * 2.5);
    this.my += (this.tmy - this.my) * Math.min(1, dt * 2.5);
    var r = this.host.getBoundingClientRect();
    this.scroll = clamp(-r.top / Math.max(1, r.height), 0, 1);

    var D = this.D, dk;
    for (dk in D) D[dk].count = 0;
    if (this.cfg.kind === 'hub') this.writeHub(dt);
    else { this.updateTraffic(Math.min(dt, 0.05)); this.writeCars(); this.writeDrones(); }
    for (dk in D) D[dk].upload();

    var L = norm([-0.55, 0.78, 0.38]);
    var ext = this.rad + 6;
    var lv = lookAt([L[0] * 80, L[1] * 80, L[2] * 80], [0, 0, 0], [0, 1, 0]);
    var LVP = mul(ortho(-ext, ext, -ext, ext, 20, 160), lv);
    var VP = this.camera();
    var all = [], ak;
    for (ak in this.S) all.push(this.S[ak]);
    for (ak in D) all.push(D[ak]);

    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    if (this.useSM) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.smFb);
      gl.viewport(0, 0, this.smSize, this.smSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
      var sp = this.shProg; gl.useProgram(sp.p);
      gl.uniformMatrix4fv(sp.u.uLVP, false, LVP); gl.uniform1f(sp.u.uT, this.t); gl.uniform1f(sp.u.uRise, this.riseT);
      all.forEach(function (b) { b.draw(); });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(31.5 / 255, 30.5 / 255, 28.5 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var p = this.prog, u = p.u; gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uLVP, false, LVP);
    gl.uniform1f(u.uT, this.t); gl.uniform1f(u.uRise, this.riseT);
    gl.uniform3fv(u.uL, L);
    gl.uniform3f(u.uSun, 1.05, 0.86, 0.66);
    gl.uniform3f(u.uSky, 0.27, 0.27, 0.285);
    gl.uniform3f(u.uGnd, 0.07, 0.065, 0.06);
    gl.uniform3fv(u.uFog, C.bg);
    var w = this.cfg.win; gl.uniform3f(u.uWin, C.win[0] * 1.15 * w, C.win[1] * 1.15 * w, C.win[2] * 1.15 * w);
    gl.uniform3fv(u.uEye, this.eye);
    gl.uniform1f(u.uFogD, 1 / (Math.hypot(this.eye[0], this.eye[1], this.eye[2]) * 1.9));
    gl.uniform1f(u.uRad, this.rad);
    gl.uniform1f(u.uUseSM, this.useSM ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.smTex); gl.uniform1i(u.uSM, 0);
    all.forEach(function (b) { b.draw(); });
    gl.bindVertexArray(null);

    if (!this.shown) { this.shown = true; this.canvas.style.opacity = '1'; this.host.classList.add('city-live'); }
  };

  City.prototype.fallback = function () {
    this.host.classList.remove('city-live');
    poster(this.host);
    if (this.canvas) this.canvas.style.opacity = '0';
  };

  /* ---------- boot ---------- */
  var cities = [];
  // Still image for browsers without WebGL2; only shown once it has loaded.
  function poster(host) {
    var img = host.querySelector('img.city-poster[data-src]');
    if (!img || img.getAttribute('src')) return;
    var pre = new Image();
    pre.onload = function () { img.setAttribute('src', pre.src); };
    pre.src = img.getAttribute('data-src');
  }
  hosts.forEach(function (h) {
    try { cities.push(new City(h)); } catch (e) { poster(h); if (window.console) console.warn('city3d:', e.message); }
  });
  if (!cities.length) return;

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        cities.forEach(function (c) {
          if (c.host === e.target) { c.visible = e.isIntersecting; if (e.isIntersecting) c.started = true; }
        });
      });
    }, { rootMargin: '120px 0px' });
    cities.forEach(function (c) { io.observe(c.host); });
  } else cities.forEach(function (c) { c.visible = c.started = true; });

  function sizeAll() { cities.forEach(function (c) { c.resize(); }); }
  sizeAll();
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(sizeAll);
    cities.forEach(function (c) { ro.observe(c.host); });
  } else window.addEventListener('resize', sizeAll);

  if (FINE && !REDUCE) {
    window.addEventListener('pointermove', function (e) {
      var x = e.clientX / window.innerWidth * 2 - 1, y = e.clientY / window.innerHeight * 2 - 1;
      cities.forEach(function (c) { c.tmx = x; c.tmy = y; });
    }, { passive: true });
  }

  // Adaptive quality: if frames run slow on a weak GPU, lower resolution,
  // then drop shadows, then draw every other frame, so the page stays smooth.
  var last = 0, acc = 0, tick = 0, sampled = 0, sampleMs = 0;
  function degrade() {
    if (QUALITY.scale > 0.56) { QUALITY.scale = QUALITY.scale > 0.9 ? 0.75 : 0.55; sizeAll(); }
    else if (cities.some(function (c) { return c.useSM; })) cities.forEach(function (c) { c.useSM = false; });
    else QUALITY.skip = true;
  }
  function loop(now) {
    var raw = last ? now - last : 16.7;
    var dt = Math.min(raw / 1000, 0.1);
    last = now; acc += dt; tick++;
    if (!document.hidden && !(QUALITY.skip && tick % 2)) {
      var drew = false, step = Math.min(acc, 0.1);
      cities.forEach(function (c) {
        if (c.visible || !c.shown) {
          drew = true;
          try { c.frame(step); } catch (e) { c.dead = true; c.fallback(); if (window.console) console.warn('city3d:', e.message); }
        }
      });
      acc = 0;
      if (drew && !QUALITY.skip) {
        sampled++;
        if (sampled > 30) sampleMs += raw;
        if (sampled === 90) { if (sampleMs / 60 > 30) degrade(); sampled = 0; sampleMs = 0; }
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
