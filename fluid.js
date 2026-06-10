/* GPU fluid simulation — stable-fluids solver on WebGL2.
   Velocity/dye advection, vorticity confinement, Jacobi pressure solve, splat injection. */

const VERT = `
precision highp float;
attribute vec2 aPos;
varying vec2 vUv, vL, vR, vT, vB;
uniform vec2 texelSize;
void main () {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = {
  copy: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main () { gl_FragColor = texture2D(uTexture, vUv); }`,

  splat: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio, radius;
    uniform vec2 point;
    uniform vec3 color;
    void main () {
      vec2 p = vUv - point;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
    }`,

  advection: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity, uSource;
    uniform vec2 texelSize;
    uniform float dt, dissipation;
    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
      gl_FragColor.a = 1.0;
    }`,

  divergence: `
    precision highp float;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x;
      if (vR.x > 1.0) R = -C.x;
      if (vT.y > 1.0) T = -C.y;
      if (vB.y < 0.0) B = -C.y;
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,

  curl: `
    precision highp float;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
    }`,

  vorticity: `
    precision highp float;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform sampler2D uVelocity, uCurl;
    uniform float curl, dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
      gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
    }`,

  pressure: `
    precision highp float;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform sampler2D uPressure, uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
    }`,

  gradientSubtract: `
    precision highp float;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform sampler2D uPressure, uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
      gl_FragColor = vec4(vel, 0.0, 1.0);
    }`,

  display: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float uGlow;
    void main () {
      vec3 c = texture2D(uTexture, vUv).rgb;
      // soft tone-map + audio-reactive glow
      c = c / (1.0 + dot(c, vec3(0.25)));
      c = pow(c, vec3(0.92)) * (1.0 + uGlow * 0.25);
      float vig = smoothstep(1.25, 0.4, length(vUv - 0.5) * 1.4);
      gl_FragColor = vec4(c * vig, 1.0);
    }`,
};

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

class Program {
  constructor(gl, fragSrc) {
    this.gl = gl;
    const p = (this.prog = gl.createProgram());
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    this.uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
  }
  use() { this.gl.useProgram(this.prog); }
}

function createFBO(gl, w, h, internalFormat, format, type, filter) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return {
    texture, fbo, w, h,
    texelSize: [1 / w, 1 / h],
    attach(id) {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return id;
    },
  };
}

function createDoubleFBO(gl, w, h, intF, f, t, filter) {
  let a = createFBO(gl, w, h, intF, f, t, filter);
  let b = createFBO(gl, w, h, intF, f, t, filter);
  return {
    w, h, texelSize: a.texelSize,
    get read() { return a; },
    get write() { return b; },
    swap() { [a, b] = [b, a]; },
  };
}

export class Fluid {
  constructor(canvas, { simRes = 144, dyeRes = 720 } = {}) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', {
      alpha: false, depth: false, stencil: false, antialias: false,
      preserveDrawingBuffer: false,
    }));
    if (!gl) throw new Error('WebGL2 not supported');
    if (!gl.getExtension('EXT_color_buffer_float'))
      throw new Error('EXT_color_buffer_float not supported');
    gl.getExtension('OES_texture_float_linear');

    this.params = { curl: 22, pressureIters: 22, velDissipation: 0.995, dyeDissipation: 0.985 };
    this.simRes = simRes;
    this.dyeRes = dyeRes;

    // fullscreen triangle-strip quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.progs = {};
    for (const k in FRAG) this.progs[k] = new Program(gl, FRAG[k]);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
    const aspect = this.canvas.width / this.canvas.height;
    const simW = Math.round(this.simRes * Math.max(1, aspect));
    const simH = Math.round(this.simRes * Math.max(1, 1 / aspect));
    const dyeW = Math.round(this.dyeRes * Math.max(1, aspect));
    const dyeH = Math.round(this.dyeRes * Math.max(1, 1 / aspect));

    this.velocity = createDoubleFBO(gl, simW, simH, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
    this.pressure = createDoubleFBO(gl, simW, simH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.divergence = createFBO(gl, simW, simH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.curlTex = createFBO(gl, simW, simH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.dye = createDoubleFBO(gl, dyeW, dyeH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  }

  _blit(target) {
    const gl = this.gl;
    if (target == null) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.w, target.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** x,y in [0,1] (y up), dx,dy velocity impulse, color [r,g,b], radius ~0.001..0.05 */
  splat(x, y, dx, dy, color, radius = 0.0035) {
    const gl = this.gl;
    const aspect = this.canvas.width / this.canvas.height;
    let p = this.progs.splat;
    p.use();
    gl.uniform1f(p.uniforms.aspectRatio, aspect);
    gl.uniform2f(p.uniforms.point, x, y);
    gl.uniform1f(p.uniforms.radius, radius);

    gl.uniform1i(p.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform3f(p.uniforms.color, dx, dy, 0);
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(p.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(p.uniforms.color, color[0], color[1], color[2]);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  step(dt) {
    const gl = this.gl;
    const P = this.progs;
    dt = Math.min(dt, 1 / 30);

    // curl + vorticity confinement
    P.curl.use();
    gl.uniform1i(P.curl.uniforms.uVelocity, this.velocity.read.attach(0));
    this._setTexel(P.curl, this.velocity.texelSize);
    this._blit(this.curlTex);

    P.vorticity.use();
    gl.uniform1i(P.vorticity.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(P.vorticity.uniforms.uCurl, this.curlTex.attach(1));
    gl.uniform1f(P.vorticity.uniforms.curl, this.params.curl);
    gl.uniform1f(P.vorticity.uniforms.dt, dt);
    this._setTexel(P.vorticity, this.velocity.texelSize);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // pressure projection
    P.divergence.use();
    gl.uniform1i(P.divergence.uniforms.uVelocity, this.velocity.read.attach(0));
    this._setTexel(P.divergence, this.velocity.texelSize);
    this._blit(this.divergence);

    P.pressure.use();
    gl.uniform1i(P.pressure.uniforms.uDivergence, this.divergence.attach(0));
    this._setTexel(P.pressure, this.velocity.texelSize);
    for (let i = 0; i < this.params.pressureIters; i++) {
      gl.uniform1i(P.pressure.uniforms.uPressure, this.pressure.read.attach(1));
      this._blit(this.pressure.write);
      this.pressure.swap();
    }

    P.gradientSubtract.use();
    gl.uniform1i(P.gradientSubtract.uniforms.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(P.gradientSubtract.uniforms.uVelocity, this.velocity.read.attach(1));
    this._setTexel(P.gradientSubtract, this.velocity.texelSize);
    this._blit(this.velocity.write);
    this.velocity.swap();

    // advect velocity, then dye
    P.advection.use();
    this._setTexel(P.advection, this.velocity.texelSize);
    gl.uniform1f(P.advection.uniforms.dt, dt);
    gl.uniform1i(P.advection.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(P.advection.uniforms.uSource, this.velocity.read.attach(0));
    gl.uniform1f(P.advection.uniforms.dissipation, this.params.velDissipation);
    this._blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(P.advection.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(P.advection.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(P.advection.uniforms.dissipation, this.params.dyeDissipation);
    this._blit(this.dye.write);
    this.dye.swap();
  }

  _setTexel(prog, ts) {
    this.gl.uniform2f(prog.uniforms.texelSize, ts[0], ts[1]);
  }

  render(glow = 0) {
    const gl = this.gl;
    const p = this.progs.display;
    p.use();
    gl.uniform1i(p.uniforms.uTexture, this.dye.read.attach(0));
    gl.uniform1f(p.uniforms.uGlow, glow);
    this._blit(null);
  }
}
