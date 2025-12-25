'use strict';

let gl;
let surface;
let shProgram;
let spaceball;

let uSeg = 35;
let vSeg = 45;

let lightAngle = 0;
let lastT = 0;

// CGW Variant 18: pivot + rotation
let pivotU = 0.5;
let pivotV = 0.5;
let texAngle = 0.0;

const pivotStep = 0.02;
const angleStep = 0.15;

function clamp01(x) {
  return Math.max(0.0, Math.min(1.0, x));
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // move pivot
    if (k === 'a') pivotU -= pivotStep;
    if (k === 'd') pivotU += pivotStep;
    if (k === 'w') pivotV += pivotStep;
    if (k === 's') pivotV -= pivotStep;

    // rotate texture (for demo)
    if (k === 'q') texAngle -= angleStep;
    if (k === 'e') texAngle += angleStep;

    pivotU = clamp01(pivotU);
    pivotV = clamp01(pivotV);
  });
}

function ShaderProgram(name, program) {
  this.name = name;
  this.prog = program;

  this.iAttribVertex = -1;
  this.iAttribTexCoords = -1;
  this.iAttribNormal = -1;
  this.iAttribTangent = -1;

  this.iModelViewProjectionMatrix = -1;
  this.iModelViewMatrix = -1;
  this.iNormalMatrix = -1;

  this.iTMU0 = -1;
  this.iTMU1 = -1;
  this.iTMU2 = -1;

  this.iLightPosView = -1;
  this.iShininess = -1;

  // CGW uniforms
  this.iPivotUV = -1;
  this.iTexAngle = -1;

  this.Use = function () {
    gl.useProgram(this.prog);
  };
}

function mat4MulVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

function normalMatrixFromModelView(mv) {
  return new Float32Array([
    mv[0], mv[1], mv[2],
    mv[4], mv[5], mv[6],
    mv[8], mv[9], mv[10],
  ]);
}

function drawFrame(t) {
  const dt = (t - lastT) * 0.001;
  lastT = t;

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const projection = m4.perspective(Math.PI / 8, 1, 0.1, 50);
  const modelView0 = spaceball.getViewMatrix();

  const rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
  const translateToPointZero = m4.translation(0, 0.6, -9);

  const matAccum0 = m4.multiply(rotateToPointZero, modelView0);
  const matAccum1 = m4.multiply(translateToPointZero, matAccum0);

  const modelViewProjection = m4.multiply(projection, matAccum1);

  gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccum1);
  gl.uniformMatrix4fv(shProgram.iModelViewProjectionMatrix, false, modelViewProjection);
  gl.uniformMatrix3fv(shProgram.iNormalMatrix, false, normalMatrixFromModelView(matAccum1));

  // rotating light
  lightAngle += dt * 0.8;
  const R = 3.0;
  const H = 1.0;
  const lightWorld = [R * Math.cos(lightAngle), H, R * Math.sin(lightAngle), 1.0];
  const lightView4 = mat4MulVec4(matAccum1, lightWorld);

  gl.uniform3f(shProgram.iLightPosView, lightView4[0], lightView4[1], lightView4[2]);
  gl.uniform1f(shProgram.iShininess, 32.0);

  // texture units
  gl.uniform1i(shProgram.iTMU0, 0);
  gl.uniform1i(shProgram.iTMU1, 1);
  gl.uniform1i(shProgram.iTMU2, 2);

  // CGW uniforms
  gl.uniform2f(shProgram.iPivotUV, pivotU, pivotV);
  gl.uniform1f(shProgram.iTexAngle, texAngle);

  surface.Draw();

  requestAnimationFrame(drawFrame);
}

function initGL() {
  const prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

  shProgram = new ShaderProgram('PA3', prog);
  shProgram.Use();

  shProgram.iAttribVertex = gl.getAttribLocation(prog, 'vertex');
  shProgram.iAttribTexCoords = gl.getAttribLocation(prog, 'tex');
  shProgram.iAttribNormal = gl.getAttribLocation(prog, 'normal');
  shProgram.iAttribTangent = gl.getAttribLocation(prog, 'tangent');

  shProgram.iModelViewProjectionMatrix = gl.getUniformLocation(prog, 'ModelViewProjectionMatrix');
  shProgram.iModelViewMatrix = gl.getUniformLocation(prog, 'ModelViewMatrix');
  shProgram.iNormalMatrix = gl.getUniformLocation(prog, 'NormalMatrix');

  shProgram.iTMU0 = gl.getUniformLocation(prog, 'iTMU0');
  shProgram.iTMU1 = gl.getUniformLocation(prog, 'iTMU1');
  shProgram.iTMU2 = gl.getUniformLocation(prog, 'iTMU2');

  shProgram.iLightPosView = gl.getUniformLocation(prog, 'LightPosView');
  shProgram.iShininess = gl.getUniformLocation(prog, 'Shininess');

  // CGW uniforms
  shProgram.iPivotUV = gl.getUniformLocation(prog, 'PivotUV');
  shProgram.iTexAngle = gl.getUniformLocation(prog, 'TexAngle');

  const data = {};
  CreateSurfaceData(data, uSeg, vSeg);

  surface = new Model('SievertSurface');
  surface.BufferData(
    data.verticesF32,
    data.indicesU16,
    data.texcoordsF32,
    data.normalsF32,
    data.tangentsF32
  );

  surface.idTextureDiffuse = LoadTexture('./textures/diffuse.jpg');
  surface.idTextureSpecular = LoadTexture('./textures/specular.jpg');
  surface.idTextureNormal = LoadTexture('./textures/normal.jpg');

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
}

function createProgram(gl, vShader, fShader) {
  const vsh = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vsh, vShader);
  gl.compileShader(vsh);
  if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
    throw new Error('Error in vertex shader: ' + gl.getShaderInfoLog(vsh));
  }

  const fsh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fsh, fShader);
  gl.compileShader(fsh);
  if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
    throw new Error('Error in fragment shader: ' + gl.getShaderInfoLog(fsh));
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vsh);
  gl.attachShader(prog, fsh);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Link error in program: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function setupSliders() {
  const uSlider = document.getElementById('uSlider');
  const vSlider = document.getElementById('vSlider');
  const uVal = document.getElementById('uVal');
  const vVal = document.getElementById('vVal');

  if (!uSlider || !vSlider) return;

  uSlider.value = String(uSeg);
  vSlider.value = String(vSeg);
  if (uVal) uVal.textContent = String(uSeg);
  if (vVal) vVal.textContent = String(vSeg);

  const rebuild = () => {
    uSeg = Math.max(10, parseInt(uSlider.value, 10) || 35);
    vSeg = Math.max(10, parseInt(vSlider.value, 10) || 45);

    if (uVal) uVal.textContent = String(uSeg);
    if (vVal) vVal.textContent = String(vSeg);

    const data = {};
    CreateSurfaceData(data, uSeg, vSeg);
    surface.BufferData(
      data.verticesF32,
      data.indicesU16,
      data.texcoordsF32,
      data.normalsF32,
      data.tangentsF32
    );
  };

  uSlider.addEventListener('input', rebuild);
  vSlider.addEventListener('input', rebuild);
}

function init() {
  const canvas = document.getElementById('webglcanvas');
  gl = canvas.getContext('webgl');
  if (!gl) {
    document.getElementById('canvas-holder').innerHTML =
      '<p>Sorry, could not get a WebGL graphics context.</p>';
    return;
  }

  try {
    initGL();
  } catch (e) {
    document.getElementById('canvas-holder').innerHTML =
      '<p>Sorry, could not initialize WebGL: ' + e + '</p>';
    return;
  }

  spaceball = new TrackballRotator(canvas, () => {}, 0);
  setupSliders();
  setupKeyboard();

  requestAnimationFrame(drawFrame);
}
