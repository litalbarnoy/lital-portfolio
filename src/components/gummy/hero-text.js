/**
 * The headline, redrawn into the 3D scene so the glass can actually refract it.
 *
 * WebGPU cannot read the DOM — there is no API that lets a shader sample text
 * the browser painted. So a body of glass can only ever *hide* a `<h1>`, never
 * bend it. The reference look (letters distorted and fringed behind the glass)
 * is only possible when the text lives in the same scene as the glass.
 *
 * Rather than re-implementing text layout, this reads the layout the browser
 * already did: every character's box is measured with a Range, characters are
 * grouped into line boxes by their top edge, and each line is drawn back at its
 * own screen coordinates. Wrapping, RTL/LTR order, alignment and font metrics
 * therefore match the real element by construction, at any breakpoint, in
 * either language.
 *
 * The canvas is viewport-sized, so it maps 1:1 to the screen and the plane that
 * carries it needs no per-element placement maths.
 */
import * as THREE from 'three/webgpu';

/** Groups a text node's characters into line boxes, using the browser's own layout. */
function lineBoxesOf(textNode) {
  const text = textNode.nodeValue;
  const range = document.createRange();
  const lines = [];
  let current = null;

  for (let i = 0; i < text.length; i++) {
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // collapsed whitespace

    // A new line box starts wherever the top edge jumps.
    if (!current || Math.abs(r.top - current.top) > 1) {
      current = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: text[i] };
      lines.push(current);
    } else {
      // Only the horizontal extent accumulates. The vertical box is taken from
      // the line's first character and left alone: mixed scripts fall back to
      // different families (the Latin face here is not the one that renders
      // Hebrew), and those fallbacks report taller boxes. Growing `bottom` with
      // a max let the tallest glyph drag the line's midpoint down, which landed
      // every line roughly one line-height low.
      current.left = Math.min(current.left, r.left);
      current.right = Math.max(current.right, r.right);
      current.text += text[i];
    }
  }
  range.detach?.();
  return lines;
}

function* textNodesOf(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue.trim()) yield n;
  }
}

export class HeroText {
  /**
   * @param {string} selector element whose text should be drawn into the scene
   */
  constructor(selector = 'h1') {
    this.selector = selector;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    // A COVERAGE MASK, not a colour image: white glyphs on opaque black.
    //
    // The canvas's alpha channel does not survive upload here — sampled in the
    // shader, empty regions come back opaque black rather than transparent,
    // which dragged the whole body to near-black. Encoding coverage in
    // luminance instead sidesteps the alpha path completely, and costs nothing:
    // the headline is a single flat colour, supplied separately as a uniform.
    this.texture.colorSpace = THREE.NoColorSpace;
    // No mipmaps. The glass samples this texture through a refraction offset,
    // which gives the sampler wildly varying derivatives and sends it to a tiny
    // mip level — of a canvas that is almost entirely empty, so the lookup
    // collapses to transparent black and the body renders as a dark blob.
    // Level 0 only, with clamping, keeps the letters sharp and the empty
    // regions genuinely empty.
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.ready = false;
    this.color = '#ffffff';
    this.lastSignature = '';
  }

  /**
   * Cheap fingerprint of everything that would change the raster: where the
   * element sits, how big it is, and its colour. Compared each frame so the
   * canvas re-renders whenever the layout actually moves — which covers the
   * hero's entry animation (the element is mid-transform for the first second
   * and rasterising then bakes in a half-finished position), a resize, a font
   * swap, a palette change and scrolling, without hooking any of them.
   */
  signature() {
    const el = document.querySelector(this.selector);
    if (!el) return 'none';
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return [
      Math.round(r.left), Math.round(r.top),
      Math.round(r.width), Math.round(r.height),
      cs.color, cs.fontSize,
      window.innerWidth, window.innerHeight,
    ].join('|');
  }

  /** Fonts must be loaded first or the headline rasterises in a fallback face. */
  static async waitForFonts() {
    try { await document.fonts.ready; } catch { /* older browsers: draw anyway */ }
  }

  /**
   * Redraws at the current layout. Cheap enough to call on resize and on a
   * palette change, which is when the colour moves.
   */
  draw() {
    const el = document.querySelector(this.selector);
    if (!el) { this.ready = false; return false; }

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 1 || h < 1) { this.ready = false; return false; }

    // Full device resolution: a rasterised headline softer than the rest of the
    // page reads as a bug, not as an effect.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;

    const ctx = this.ctx;
    // No context transform. Every coordinate is scaled explicitly instead:
    // setting canvas.width resets some context state but not all of it, and a
    // stale transform silently rescaled the whole drawing — the fill covered a
    // fraction of the canvas and the headline came out the wrong size and
    // place. Multiplying by dpr by hand cannot drift.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // A coverage mask: opaque black ground, white glyphs.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    this.color = getComputedStyle(el).color;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';

    for (const node of textNodesOf(el)) {
      const ps = getComputedStyle(node.parentElement);
      const size = parseFloat(ps.fontSize) * dpr;
      // No line-height in the shorthand: it does not affect fillText, and a
      // shorthand the parser rejects leaves the previous font silently in place.
      ctx.font = `${ps.fontStyle} ${ps.fontWeight} ${size}px ${ps.fontFamily}`;
      ctx.direction = ps.direction;

      for (const line of lineBoxesOf(node)) {
        // Range rects are LINE boxes, not ink boxes: their bottom sits below the
        // baseline by the half-leading. Anchoring to the box centre with a
        // 'middle' baseline lands glyphs where the browser put them, at any
        // line-height.
        const midY = ((line.top + line.bottom) / 2) * dpr;
        if (ps.direction === 'rtl') {
          ctx.textAlign = 'right';
          ctx.fillText(line.text, line.right * dpr, midY);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(line.text, line.left * dpr, midY);
        }
      }
    }

    this.texture.needsUpdate = true;
    this.lastSignature = this.signature();
    this.ready = true;
    return true;
  }

  dispose() {
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 0;
  }
}
