function dot3(a, b) {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

function cross3(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/len, v[1]/len, v[2]/len];
}

// ===== Dual numbers for autodiff (u,v) =====
class Dual2 {
  constructor(v, du=0, dv=0) { this.v=v; this.du=du; this.dv=dv; }
  static U(x) { return new Dual2(x, 1, 0); }
  static V(x) { return new Dual2(x, 0, 1); }
  static C(x) { return new Dual2(x, 0, 0); }
}
function dAdd(a,b){ return new Dual2(a.v+b.v, a.du+b.du, a.dv+b.dv); }
function dSub(a,b){ return new Dual2(a.v-b.v, a.du-b.du, a.dv-b.dv); }
function dMul(a,b){ return new Dual2(a.v*b.v, a.du*b.v+a.v*b.du, a.dv*b.v+a.v*b.dv); }
function dDiv(a,b){
  const inv = 1.0/(b.v*b.v);
  return new Dual2(a.v/b.v, (a.du*b.v-a.v*b.du)*inv, (a.dv*b.v-a.v*b.dv)*inv);
}
function dSin(a){ return new Dual2(Math.sin(a.v), Math.cos(a.v)*a.du, Math.cos(a.v)*a.dv); }
function dCos(a){ return new Dual2(Math.cos(a.v), -Math.sin(a.v)*a.du, -Math.sin(a.v)*a.dv); }
function dTan(a){ return dDiv(dSin(a), dCos(a)); }
function dAtan(a){
  const denom = 1.0 + a.v*a.v;
  return new Dual2(Math.atan(a.v), a.du/denom, a.dv/denom);
}
function dSqrt(a){
  const r = Math.sqrt(a.v);
  const k = 0.5 / (r || 1e-12);
  return new Dual2(r, k*a.du, k*a.dv);
}
function dLog(a){
  const x = a.v || 1e-12;
  return new Dual2(Math.log(x), a.du/x, a.dv/x);
}

// ===== Sievert surface point + partial derivatives =====
function sievertPointDual(u, v) {
  const C = 1.0;
  const sqrtC = Math.sqrt(C);
  const sqrtCp1 = Math.sqrt(C + 1.0);

  const sinU = dSin(u);
  const cosU = dCos(u);
  const sinV = dSin(v);
  const cosV = dCos(v);

  const sinV2 = dMul(sinV, sinV);
  const cosU2 = dMul(cosU, cosU);
  const term = dMul(Dual2.C(C), dMul(sinV2, cosU2));
  const denom = dSub(Dual2.C(C + 1.0), term);

  const a = dDiv(Dual2.C(2.0), denom);

  const sinU2 = dMul(sinU, sinU);
  const inside = dAdd(Dual2.C(1.0), dMul(Dual2.C(C), sinU2));
  const root = dSqrt(dMul(Dual2.C(C + 1.0), inside));

  const r = dDiv(dMul(dMul(a, root), sinV), Dual2.C(sqrtC));

  const phi = dAdd(
    dMul(Dual2.C(-1.0 / sqrtCp1), u),
    dAtan(dMul(dTan(u), Dual2.C(sqrtCp1)))
  );

  const x = dMul(r, dCos(phi));
  const y = dMul(r, dSin(phi));

  const vHalf = dMul(v, Dual2.C(0.5));
  const logTan = dLog(dTan(vHalf));
  const zTop = dAdd(logTan, dMul(dMul(a, Dual2.C(C + 1.0)), cosV));
  const z = dDiv(zTop, Dual2.C(sqrtC));

  const s = 0.8;
  return {
    p:  [s*x.v,  s*y.v,  s*z.v],
    Su: [s*x.du, s*y.du, s*z.du],
    Sv: [s*x.dv, s*y.dv, s*z.dv],
  };
}

// ===== WebGL Model =====
function Model(name) {
  this.name = name;

  this.iVertexBuffer = gl.createBuffer();
  this.iTexCoordsBuffer = gl.createBuffer();
  this.iNormalBuffer = gl.createBuffer();
  this.iTangentBuffer = gl.createBuffer();
  this.iIndexBuffer = gl.createBuffer();

  this.count = 0;

  this.idTextureDiffuse = -1;
  this.idTextureSpecular = -1;
  this.idTextureNormal = -1;

  this.BufferData = function(vertices, indices, texCoords, normals, tangents) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iTexCoordsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iTangentBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tangents, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.count = indices.length;
  };

  this.Draw = function() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.idTextureDiffuse);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.idTextureSpecular);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.idTextureNormal);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
    gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribVertex);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iTexCoordsBuffer);
    gl.vertexAttribPointer(shProgram.iAttribTexCoords, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribTexCoords);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iNormalBuffer);
    gl.vertexAttribPointer(shProgram.iAttribNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribNormal);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.iTangentBuffer);
    gl.vertexAttribPointer(shProgram.iAttribTangent, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shProgram.iAttribTangent);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  };
}

// ===== Mesh generation for Sievert surface =====
function CreateSurfaceData(data, uSteps, vSteps) {
  const uMin = -1.5;
  const uMax =  1.5;
  const vMin = 0.05;
  const vMax = Math.PI - 0.05;

  const positions = [];
  const texcoords = [];
  const normals = [];
  const tangents = [];
  const indices = [];

  const vCount = vSteps + 1;

  for (let i = 0; i <= uSteps; i++) {
    const uVal = uMin + (uMax - uMin) * (i / uSteps);
    const tu = (uVal - uMin) / (uMax - uMin);

    for (let j = 0; j <= vSteps; j++) {
      const vVal = vMin + (vMax - vMin) * (j / vSteps);
      const tv = (vVal - vMin) / (vMax - vMin);

      const res = sievertPointDual(Dual2.U(uVal), Dual2.V(vVal));

      const N = normalize3(cross3(res.Su, res.Sv));
      const Traw = normalize3(res.Su);

      // Gram-Schmidt: make T orthogonal to N
      const proj = dot3(N, Traw);
      const Tgs = normalize3([
        Traw[0] - N[0]*proj,
        Traw[1] - N[1]*proj,
        Traw[2] - N[2]*proj
      ]);

      const Btest = cross3(N, Tgs);
      const handedness = (dot3(Btest, res.Sv) < 0.0) ? -1.0 : 1.0;

      positions.push(res.p[0], res.p[1], res.p[2]);
      texcoords.push(tu, tv);
      normals.push(N[0], N[1], N[2]);
      tangents.push(Tgs[0], Tgs[1], Tgs[2], handedness);
    }
  }

  function idx(i, j) { return i * vCount + j; }

  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i, j + 1);
      const d = idx(i + 1, j + 1);

      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  data.verticesF32  = new Float32Array(positions);
  data.texcoordsF32 = new Float32Array(texcoords);
  data.normalsF32   = new Float32Array(normals);
  data.tangentsF32  = new Float32Array(tangents);
  data.indicesU16   = new Uint16Array(indices);
}
