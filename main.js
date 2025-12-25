'use strict';

let gl;
let surface;
let shProgram;
let spaceball;

// PA2 state
let uSeg = 35;
let vSeg = 45;

let lightAngle = 0;
let lastT = 0;

// -------------------- math helpers --------------------
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Column-major mat4 * vec4
function mat4MulVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

// For rotations+translations (no non-uniform scale): normalMatrix = top-left 3x3 of modelView
function normalMatrixFromModelView(mv) {
  return new Float32Array([
    mv[0], mv[1], mv[2],
    mv[4], mv[5], mv[6],
    mv[8], mv[9], mv[10],
  ]);
}

// -------------------- Dual numbers (analytic derivatives) --------------------
class Dual2 {
  constructor(v, du = 0, dv = 0) {
    this.v = v;
    this.du = du;
    this.dv = dv;
  }

  static U(x) { return new Dual2(x, 1, 0); } // derivative wrt u
  static V(x) { return new Dual2(x, 0, 1); } // derivative wrt v
  static C(x) { return new Dual2(x, 0, 0); } // constant
}

function dAdd(a, b) { return new Dual2(a.v + b.v, a.du + b.du, a.dv + b.dv); }
function dSub(a, b) { return new Dual2(a.v - b.v, a.du - b.du, a.dv - b.dv); }
function dMul(a, b) {
  return new Dual2(
    a.v * b.v,
    a.du * b.v + a.v * b.du,
    a.dv * b.v + a.v * b.dv
  );
}
function dDiv(a, b) {
  const inv = 1.0 / (b.v * b.v);
  return new Dual2(
    a.v / b.v,
    (a.du * b.v - a.v * b.du) * inv,
    (a.dv * b.v - a.v * b.dv) * inv
  );
}
function dSin(a) { return new Dual2(Math.sin(a.v), Math.cos(a.v) * a.du, Math.cos(a.v) * a.dv); }
function dCos(a) { return new Dual2(Math.cos(a.v), -Math.sin(a.v) * a.du, -Math.sin(a.v) * a.dv); }
function dTan(a) { return dDiv(dSin(a), dCos(a)); }
function dAtan(a) {
  const denom = 1.0 + a.v * a.v;
  return new Dual2(Math.atan(a.v), a.du / denom, a.dv / denom);
}
function dSqrt(a) {
  const r = Math.sqrt(a.v);
  const k = 0.5 / (r || 1e-12);
  return new Dual2(r, k * a.du, k * a.dv);
}
function dLog(a) {
  const x = a.v || 1e-12;
  return new Dual2(Math.log(x), a.du / x, a.dv / x);
}

// -------------------- Surface (Sievert) with analytic tangents --------------------
function sievertPointDual(u, v) {
  const C = 1.0;
  const sqrtC = Math.sqrt(C);
  const sqrtCp1 = Math.sqrt(C + 1.0);

  const sinU = dSin(u);
  const cosU = dCos(u);
  const sinV = dSin(v);
  const cosV = dCos(v);

  // denom = (C+1) - C*sinV^2*cosU^2
  const sinV2 = dMul(sinV, sinV);
  const cosU2 = dMul(cosU, cosU);
  const term = dMul(Dual2.C(C), dMul(sinV2, cosU2));
  const denom = dSub(Dual2.C(C + 1.0), term);

  const a = dDiv(Dual2.C(2.0), denom);

  // root = sqrt((C+1)*(1 + C*sinU^2))
  const sinU2 = dMul(sinU, sinU);
  const inside = dAdd(Dual2.C(1.0), dMul(Dual2.C(C), sinU2));
  const root = dSqrt(dMul(Dual2.C(C + 1.0), inside));

  // r = (a * root * sinV) / sqrtC
  const r = dDiv(dMul(dMul(a, root), sinV), Dual2.C(sqrtC));

  // phi = -u/sqrtCp1 + atan(tan(u)*sqrtCp1)
  const phi = dAdd(
    dMul(Dual2.C(-1.0 / sqrtCp1), u),
    dAtan(dMul(dTan(u), Dual2.C(sqrtCp1)))
  );

  const x = dMul(r, dCos(phi));
  const y = dMul(r, dSin(phi));

  // z = (log(tan(v/2)) + a*(C+1)*cosV)/sqrtC
  const vHalf = dMul(v, Dual2.C(0.5));
  const logTan = dLog(dTan(vHalf));
  const zTop = dAdd(logTan, dMul(dMul(a, Dual2.C(C + 1.0)), cosV));
  const z = dDiv(zTop, Dual2.C(sqrtC));

  const s = 0.8;

  return {
    p: [s * x.v, s * y.v, s * z.v],
    Su: [s * x.du, s * y.du, s * z.du], // ∂S/∂u
    Sv: [s * x.dv, s * y.dv, s * z.dv], // ∂S/∂v
  };
}

// -------------------- Mesh generation (triangles + normals + indices) --------------------
function CreateSurfaceMesh(uSegm, vSegm) {
  const uMin = -1.5;
  const uMax = 1.5;
  const vMin = 0.05;
  const vMax = Math.PI - 0.05;

  const positions = [];
  const normals = [];
  const indices = [];

  const vCount = vSegm + 1;

  for (let i = 0; i <= uSegm; i++) {
    const uVal = uMin + (uMax - uMin) * (i / uSegm);
    for (let j = 0; j <= vSegm; j++) {
      const vVal = vMin + (vMax - vMin) * (j / vSegm);

      const res = sievertPointDual(Dual2.U(uVal), Dual2.V(vVal));
      const N = normalize(cross(res.Su, res.Sv));

      positions.push(res.p[0], res.p[1], res.p[2]);
      normals.push(N[0], N[1], N[2]);
    }
  }

  function idx(i, j) { return i * vCount + j; }

  for (let i = 0; i < uSegm; i++) {
    for (let j = 0; j < vSegm; j++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i, j + 1);
      const d = idx(i + 1, j + 1);

      // two triangles per cell
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// -------------------- Model (VBO pos + VBO normal + EBO indices) --------------------
function Model(name) {
  this.name = name;

  this.posBuffer = null;
  this.normBuffer = null;
  this.indexBuffer = null;

  this.indexCount = 0;

  this.initBuffers = function () {
    if (!this.posBuffer) this.posBuffer = gl.createBuffer();
    if (!this.normBuffer) this.normBuffer = gl.createBuffer();
    if (!this.indexBuffer) this.indexBuffer = gl.createBuffer();
  };

  this.BufferData = function (mesh) {
    this.initBuffers();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    this.indexCount = mesh.indices.length;
  };

  this.Draw = function () {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.vertexAttribPointer(shProgram.iAttribPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribPos);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuffer);
    gl.vertexAttribPointer(shProgram.iAttribNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribNormal);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  };
}

// -------------------- Shader program handles (PA2 Gouraud) --------------------
function ShaderProgram(name, program) {
  this.name = name;
  this.prog = program;

  // attributes
  this.iAttribPos = -1;
  this.iAttribNormal = -1;

  // uniforms
  this.uModelView = null;
  this.uProjection = null;
  this.uNormalMatrix = null;

  this.uLightPosView = null;
  this.uShininess = null;

  this.Use = function () { gl.useProgram(this.prog); };
}

// -------------------- WebGL init/program --------------------
function createProgram(glctx, vShader, fShader) {
  const vsh = glctx.createShader(glctx.VERTEX_SHADER);
  glctx.shaderSource(vsh, vShader);
  glctx.compileShader(vsh);
  if (!glctx.getShaderParameter(vsh, glctx.COMPILE_STATUS)) {
    throw new Error('Ошибка компиляции vertex shader: ' + glctx.getShaderInfoLog(vsh));
  }

  const fsh = glctx.createShader(glctx.FRAGMENT_SHADER);
  glctx.shaderSource(fsh, fShader);
  glctx.compileShader(fsh);
  if (!glctx.getShaderParameter(fsh, glctx.COMPILE_STATUS)) {
    throw new Error('Ошибка компиляции fragment shader: ' + glctx.getShaderInfoLog(fsh));
  }

  const prog = glctx.createProgram();
  glctx.attachShader(prog, vsh);
  glctx.attachShader(prog, fsh);
  glctx.linkProgram(prog);
  if (!glctx.getProgramParameter(prog, glctx.LINK_STATUS)) {
    throw new Error('Ошибка линковки program: ' + glctx.getProgramInfoLog(prog));
  }
  return prog;
}

function initGL() {
  // vertexShaderSource / fragmentShaderSource должны быть из shader.gpu (обновлённого под PA2!)
  const prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

  shProgram = new ShaderProgram('PA2', prog);
  shProgram.Use();

  shProgram.iAttribPos = gl.getAttribLocation(prog, 'aPosition');
  shProgram.iAttribNormal = gl.getAttribLocation(prog, 'aNormal');

  shProgram.uModelView = gl.getUniformLocation(prog, 'uModelView');
  shProgram.uProjection = gl.getUniformLocation(prog, 'uProjection');
  shProgram.uNormalMatrix = gl.getUniformLocation(prog, 'uNormalMatrix');

  shProgram.uLightPosView = gl.getUniformLocation(prog, 'uLightPosView');
  shProgram.uShininess = gl.getUniformLocation(prog, 'uShininess');

  if (shProgram.iAttribPos < 0 || shProgram.iAttribNormal < 0) {
    throw new Error('Не найдены атрибуты aPosition/aNormal. Проверь shader.gpu.');
  }

  surface = new Model('SievertSurface');
  surface.BufferData(CreateSurfaceMesh(uSeg, vSeg));

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
}

// -------------------- UI (sliders) --------------------
function setupSliders() {
  const uSlider = document.getElementById('uSlider');
  const vSlider = document.getElementById('vSlider');
  const uVal = document.getElementById('uVal');
  const vVal = document.getElementById('vVal');

  if (!uSlider || !vSlider) {
    // если ты ещё не добавил слайдеры в index.html — просто работаем с дефолтными
    return;
  }

  uSlider.value = String(uSeg);
  vSlider.value = String(vSeg);
  if (uVal) uVal.textContent = String(uSeg);
  if (vVal) vVal.textContent = String(vSeg);

  const rebuild = () => {
    uSeg = Math.max(5, parseInt(uSlider.value, 10) || 35);
    vSeg = Math.max(5, parseInt(vSlider.value, 10) || 45);

    if (uVal) uVal.textContent = String(uSeg);
    if (vVal) vVal.textContent = String(vSeg);

    surface.BufferData(CreateSurfaceMesh(uSeg, vSeg));
  };

  uSlider.addEventListener('input', rebuild);
  vSlider.addEventListener('input', rebuild);
}

// -------------------- Render loop (light вращается) --------------------
function renderFrame(t) {
  const dt = (t - lastT) * 0.001;
  lastT = t;

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Matrices (как у тебя было)
  const projection = m4.perspective(Math.PI / 8, 1, 8, 12);
  const view = spaceball.getViewMatrix();

  const rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
  const translateToPointZero = m4.translation(0, 0.6, -9);

  const mv0 = m4.multiply(rotateToPointZero, view);
  const modelView = m4.multiply(translateToPointZero, mv0);

  // Light вращается по окружности в world -> переводим в view: modelView * lightWorld
  lightAngle += dt * 0.8;
  const R = 3.0;
  const H = 1.0;
  const lightWorld = [R * Math.cos(lightAngle), H, R * Math.sin(lightAngle), 1.0];
  const lightView4 = mat4MulVec4(modelView, lightWorld);

  // uniforms
  gl.uniformMatrix4fv(shProgram.uProjection, false, projection);
  gl.uniformMatrix4fv(shProgram.uModelView, false, modelView);
  gl.uniformMatrix3fv(shProgram.uNormalMatrix, false, normalMatrixFromModelView(modelView));
  gl.uniform3f(shProgram.uLightPosView, lightView4[0], lightView4[1], lightView4[2]);
  gl.uniform1f(shProgram.uShininess, 32.0);

  // draw
  surface.Draw();

  requestAnimationFrame(renderFrame);
}

// -------------------- Entry --------------------
function init() {
  let canvas;
  try {
    canvas = document.getElementById('webglcanvas');
    gl = canvas.getContext('webgl');
    if (!gl) throw new Error('Browser does not support WebGL');
    gl.viewport(0, 0, canvas.width, canvas.height);
  } catch (e) {
    document.getElementById('canvas-holder').innerHTML =
      '<p>Sorry, could not get a WebGL graphics context.</p>';
    return;
  }

  try {
    initGL();
  } catch (e) {
    document.getElementById('canvas-holder').innerHTML =
      '<p>Sorry, could not initialize the WebGL graphics context: ' + e + '</p>';
    return;
  }

  // Trackball (мы рендерим каждый кадр сами)
  spaceball = new TrackballRotator(canvas, () => {}, 0);

  setupSliders();

  requestAnimationFrame(renderFrame);
}
