'use strict';

let gl;
let surface;
let shProgram;
let spaceball;

function deg2rad(angle) {
    return angle * Math.PI / 180;
}

function Model(name) {
    this.name = name;
    this.iVertexBuffer = null;
    this.uLines = [];
    this.vLines = [];

    this.initBuffer = function () {
        if (!this.iVertexBuffer) {
            this.iVertexBuffer = gl.createBuffer();
        }
    };

    this.BufferData = function (surfaceData) {
        this.uLines = surfaceData.uLines || [];
        this.vLines = surfaceData.vLines || [];
        this.initBuffer();
    };

    this.drawPolyline = function (vertices) {
        if (!vertices || vertices.length === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.drawArrays(gl.LINE_STRIP, 0, vertices.length / 3);
    };

    this.Draw = function () {
        for (let i = 0; i < this.uLines.length; i++) {
            this.drawPolyline(this.uLines[i]);
        }
        for (let j = 0; j < this.vLines.length; j++) {
            this.drawPolyline(this.vLines[j]);
        }
    };
}

function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;
    this.iAttribVertex = -1;
    this.iColor = -1;
    this.iModelViewProjectionMatrix = -1;

    this.Use = function () {
        gl.useProgram(this.prog);
    };
}

function sievertPoint(u, v) {
    const C = 1.0;
    const sqrtC = Math.sqrt(C);
    const sqrtCp1 = Math.sqrt(C + 1.0);

    const sinU = Math.sin(u);
    const cosU = Math.cos(u);
    const sinV = Math.sin(v);
    const cosV = Math.cos(v);

    const denom = (C + 1.0) - C * sinV * sinV * cosU * cosU;
    const a = 2.0 / denom;

    const r = (a * Math.sqrt((C + 1.0) * (1.0 + C * sinU * sinU)) * sinV) / sqrtC;
    const phi = -u / sqrtCp1 + Math.atan(Math.tan(u) * sqrtCp1);

    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    const z = (Math.log(Math.tan(v / 2.0)) + a * (C + 1.0) * cosV) / sqrtC;

    const s = 0.8;
    return [s * x, s * y, s * z];
}

function CreateSurfaceData() {
    const uLines = [];
    const vLines = [];

    const uMin = -1.5;
    const uMax = 1.5;
    const vMin = 0.05;
    const vMax = Math.PI - 0.05;

    const uSteps = 35;
    const vSteps = 45;

    for (let i = 0; i <= uSteps; i++) {
        const u = uMin + (uMax - uMin) * (i / uSteps);
        const line = [];
        for (let j = 0; j <= vSteps; j++) {
            const v = vMin + (vMax - vMin) * (j / vSteps);
            const p = sievertPoint(u, v);
            line.push(p[0], p[1], p[2]);
        }
        uLines.push(line);
    }

    for (let j = 0; j <= vSteps; j++) {
        const v = vMin + (vMax - vMin) * (j / vSteps);
        const line = [];
        for (let i = 0; i <= uSteps; i++) {
            const u = uMin + (uMax - uMin) * (i / uSteps);
            const p = sievertPoint(u, v);
            line.push(p[0], p[1], p[2]);
        }
        vLines.push(line);
    }

    return { uLines: uLines, vLines: vLines };
}

function draw() {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const projection = m4.perspective(Math.PI / 8, 1, 8, 12);
    const modelView = spaceball.getViewMatrix();

    const rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
    const translateToPointZero = m4.translation(0, 0.6, -9);

    const matAccum0 = m4.multiply(rotateToPointZero, modelView);
    const matAccum1 = m4.multiply(translateToPointZero, matAccum0);

    const modelViewProjection = m4.multiply(projection, matAccum1);

    gl.uniformMatrix4fv(
        shProgram.iModelViewProjectionMatrix,
        false,
        modelViewProjection
    );

    gl.uniform4fv(shProgram.iColor, [1, 1, 0, 1]);

    surface.Draw();
}

function initGL() {
    const prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);

    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex = gl.getAttribLocation(prog, 'vertex');
    shProgram.iModelViewProjectionMatrix = gl.getUniformLocation(
        prog,
        'ModelViewProjectionMatrix'
    );
    shProgram.iColor = gl.getUniformLocation(prog, 'color');

    surface = new Model('SievertSurface');
    surface.BufferData(CreateSurfaceData());

    gl.enable(gl.DEPTH_TEST);
}

function createProgram(gl, vShader, fShader) {
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vShader);
    gl.compileShader(vsh);
    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error('Error in vertex shader:  ' + gl.getShaderInfoLog(vsh));
    }

    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fShader);
    gl.compileShader(fsh);
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error('Error in fragment shader:  ' + gl.getShaderInfoLog(fsh));
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Link error in program:  ' + gl.getProgramInfoLog(prog));
    }
    return prog;
}

function init() {
    let canvas;
    try {
        canvas = document.getElementById('webglcanvas');
        gl = canvas.getContext('webgl');
        if (!gl) {
            throw 'Browser does not support WebGL';
        }
    } catch (e) {
        document.getElementById('canvas-holder').innerHTML =
            '<p>Sorry, could not get a WebGL graphics context.</p>';
        return;
    }

    try {
        initGL();
    } catch (e) {
        document.getElementById('canvas-holder').innerHTML =
            '<p>Sorry, could not initialize the WebGL graphics context: ' +
            e +
            '</p>';
        return;
    }

    spaceball = new TrackballRotator(canvas, draw, 0);
    draw();
}
