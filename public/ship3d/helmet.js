/**
 * Interfaz sobre la vista 3D:
 *  - Casco en primera persona: borde interior, visera con tinte dorado, reflejos en el vidrio,
 *    anillo del cuello, vaho de la respiración y pantalla del visor (O₂, presión, pulso).
 *  - Mira central + texto de lo que se está apuntando ("CORTAR CABLE 2").
 *  - Destello rojo al cometer un error.
 *  - Botón de sonido (tecla M).
 * Todo es HTML/SVG encima del canvas (no afecta al rendimiento del 3D).
 */

const css = `
#helmetOverlay{position:fixed;inset:0;z-index:6;pointer-events:none;display:none}
#helmetOverlay svg{width:100%;height:100%;display:block}
#helmetOverlay .fog{position:absolute;left:50%;bottom:-8%;width:46%;height:34%;transform:translateX(-50%);
  background:radial-gradient(ellipse at center,rgba(220,235,255,.16),rgba(220,235,255,0) 70%);
  animation:aetherBreath 4.4s ease-in-out infinite;opacity:0}
#helmetOverlay.danger .fog{animation-duration:2.6s}
@keyframes aetherBreath{0%,30%{opacity:0}55%{opacity:1}100%{opacity:0}}
#helmetOverlay .readout{position:absolute;font:600 11px "Share Tech Mono",monospace;color:rgba(125,211,252,.85);
  text-shadow:0 0 6px rgba(56,189,248,.6);letter-spacing:.08em;line-height:1.5}
#helmetOverlay .readout b{color:rgba(186,230,253,.95);font-weight:700}
#helmetOverlay.danger .readout .hr{color:#fca5a5}
#aetherAim{position:fixed;left:50%;top:50%;z-index:26;pointer-events:none;display:none;transform:translate(-50%,-50%)}
#aetherAim .dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 4px #000;margin:auto}
#aetherAim .ring{position:absolute;left:50%;top:50%;width:26px;height:26px;border:2px solid rgba(251,191,36,.95);border-radius:50%;
  transform:translate(-50%,-50%) scale(.6);opacity:0;transition:all .12s}
#aetherAim.on .ring{opacity:1;transform:translate(-50%,-50%) scale(1)}
#aetherAimLabel{position:fixed;z-index:26;pointer-events:none;display:none;transform:translate(-50%,22px);white-space:nowrap;
  font:700 12px Orbitron,monospace;letter-spacing:.06em;color:#fde68a;background:rgba(2,6,23,.75);border:1px solid rgba(251,191,36,.6);
  padding:3px 8px;border-radius:6px}
#aetherStrike{position:fixed;inset:0;z-index:7;pointer-events:none;opacity:0;transition:opacity .6s;
  background:radial-gradient(ellipse at center,rgba(220,38,38,0) 40%,rgba(220,38,38,.55) 100%)}
#aetherSound{position:fixed;left:16px;top:112px;z-index:30;display:none;font:700 10px "Share Tech Mono",monospace;letter-spacing:.08em;
  color:#a5f3fc;background:rgba(15,23,42,.85);border:1px solid rgba(71,85,105,.8);border-radius:8px;padding:7px 11px;cursor:pointer}
#aetherSound:hover{border-color:rgba(34,211,238,.6)}
#aetherHandPad{position:fixed;left:16px;top:150px;z-index:30;display:none;font:700 10px "Share Tech Mono",monospace;letter-spacing:.08em;
  color:#a5f3fc;background:rgba(15,23,42,.85);border:1px solid rgba(71,85,105,.8);border-radius:8px;padding:7px 11px;cursor:pointer}
#aetherHandPad:hover,#aetherHandPad[aria-expanded="true"]{border-color:#22d3ee}
@media (min-width:768px){#aetherSound{left:28px;top:128px}}
@media (min-width:768px){#aetherHandPad{left:28px;top:166px}}
`;

// Forma de la visera: un rectángulo muy redondeado (superelipse), más plano arriba
function visorPath(w, h) {
  const cx = w / 2;
  const top = h * 0.07;
  const bottom = h * 0.9;
  const left = w * 0.04;
  const right = w * 0.96;
  return [
    `M ${left} ${h * 0.42}`,
    `C ${left} ${top + h * 0.08}, ${w * 0.16} ${top}, ${cx} ${top}`,
    `C ${w * 0.84} ${top}, ${right} ${top + h * 0.08}, ${right} ${h * 0.42}`,
    `C ${right} ${h * 0.7}, ${w * 0.8} ${bottom}, ${cx} ${bottom}`,
    `C ${w * 0.2} ${bottom}, ${left} ${h * 0.7}, ${left} ${h * 0.42} Z`
  ].join(' ');
}

export function createHelmetUI({ onToggleSound, isSoundEnabled, onToggleHandPad }) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const W = 1600;
  const H = 900;
  const visor = visorPath(W, H);
  const overlay = document.createElement('div');
  overlay.id = 'helmetOverlay';
  overlay.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <radialGradient id="hgVignette" cx="50%" cy="46%" r="62%">
        <stop offset="62%" stop-color="#000" stop-opacity="0"/>
        <stop offset="88%" stop-color="#000" stop-opacity=".45"/>
        <stop offset="100%" stop-color="#000" stop-opacity=".85"/>
      </radialGradient>
      <linearGradient id="hgGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffb84d" stop-opacity=".10"/>
        <stop offset="45%" stop-color="#ffcf70" stop-opacity=".03"/>
        <stop offset="100%" stop-color="#ffb84d" stop-opacity=".0"/>
      </linearGradient>
      <linearGradient id="hgRim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2a3038"/>
        <stop offset="50%" stop-color="#0d1014"/>
        <stop offset="100%" stop-color="#1c2027"/>
      </linearGradient>
      <linearGradient id="hgShine" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff" stop-opacity=".22"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <!-- Tinte dorado y oscurecimiento de los bordes del vidrio -->
    <path d="${visor}" fill="url(#hgGold)"/>
    <path d="${visor}" fill="url(#hgVignette)"/>
    <!-- Reflejos en el vidrio curvo -->
    <path d="M ${W * 0.12} ${H * 0.26} C ${W * 0.2} ${H * 0.12}, ${W * 0.34} ${H * 0.09}, ${W * 0.46} ${H * 0.095}
             C ${W * 0.34} ${H * 0.12}, ${W * 0.22} ${H * 0.17}, ${W * 0.14} ${H * 0.3} Z" fill="url(#hgShine)"/>
    <path d="M ${W * 0.86} ${H * 0.2} C ${W * 0.9} ${H * 0.27}, ${W * 0.92} ${H * 0.36}, ${W * 0.925} ${H * 0.44}"
          stroke="#fff" stroke-opacity=".10" stroke-width="10" fill="none" stroke-linecap="round"/>
    <!-- Borde interior del casco (todo lo que queda fuera de la visera) -->
    <path d="M0 0 H${W} V${H} H0 Z ${visor}" fill="url(#hgRim)" fill-rule="evenodd"/>
    <path d="${visor}" fill="none" stroke="#5b6573" stroke-width="5" stroke-opacity=".7"/>
    <path d="${visor}" fill="none" stroke="#000" stroke-width="18" stroke-opacity=".35" transform="translate(0,6)"/>
    <!-- Anillo del cuello (abajo) -->
    <path d="M ${W * 0.18} ${H} C ${W * 0.3} ${H * 0.9}, ${W * 0.7} ${H * 0.9}, ${W * 0.82} ${H}" fill="#14181e" stroke="#7b8594" stroke-width="4"/>
    <!-- Marcas de la pantalla del visor -->
    <g stroke="#38bdf8" stroke-opacity=".55" stroke-width="2" fill="none">
      <path d="M ${W * 0.2} ${H * 0.2} h 40 M ${W * 0.2} ${H * 0.2} v 30"/>
      <path d="M ${W * 0.8} ${H * 0.2} h -40 M ${W * 0.8} ${H * 0.2} v 30"/>
      <path d="M ${W * 0.2} ${H * 0.74} h 40 M ${W * 0.2} ${H * 0.74} v -30"/>
      <path d="M ${W * 0.8} ${H * 0.74} h -40 M ${W * 0.8} ${H * 0.74} v -30"/>
    </g>
  </svg>
  <div class="fog"></div>
  <div class="readout" style="left:21%;top:22.5%">O₂ <b id="hO2">98%</b><br>PRES <b>29,6 kPa</b><br>CO₂ <b id="hCO2">0,4%</b></div>
  <div class="readout" style="right:21%;top:22.5%;text-align:right">TRAJE <b id="hSuit">NOMINAL</b><br><span class="hr">PULSO <b id="hHR">78</b> lpm</span><br>TEMP <b>21 °C</b></div>`;
  document.body.appendChild(overlay);

  const aim = document.createElement('div');
  aim.id = 'aetherAim';
  aim.innerHTML = '<div class="dot"></div><div class="ring"></div>';
  document.body.appendChild(aim);
  const aimLabel = document.createElement('div');
  aimLabel.id = 'aetherAimLabel';
  document.body.appendChild(aimLabel);

  const strike = document.createElement('div');
  strike.id = 'aetherStrike';
  document.body.appendChild(strike);

  const sound = document.createElement('button');
  sound.id = 'aetherSound';
  sound.type = 'button';
  sound.title = 'Efectos de sonido del modo 3D (tecla M)';
  sound.onclick = () => onToggleSound();
  document.body.appendChild(sound);

  const handPad = document.createElement('button');
  handPad.id = 'aetherHandPad';
  handPad.type = 'button';
  handPad.title = 'Panel de muñeca: radio, chat, voz, sonido y música (tecla Q)';
  handPad.onclick = () => onToggleHandPad();
  document.body.appendChild(handPad);

  let lastReadout = 0;
  let hr = 78;

  return {
    // Visible solo en el modo 3D
    setVisible(on) {
      sound.style.display = on ? 'block' : 'none';
      if (!on) {
        handPad.style.display = 'none';
        overlay.style.display = 'none';
        aim.style.display = 'none';
        aimLabel.style.display = 'none';
      }
    },
    renderSound() {
      sound.textContent = isSoundEnabled() ? '🔊 SONIDO [M]' : '🔇 SIN SONIDO [M]';
    },
    setHandPad({ visible, open }) {
      handPad.style.display = visible ? 'block' : 'none';
      handPad.textContent = open ? '📟 BAJAR PANEL [Q]' : '📟 PANEL [Q]';
      handPad.setAttribute('aria-expanded', String(open));
    },
    setFirstPerson(on) {
      overlay.style.display = on ? 'block' : 'none';
    },
    // locked: mouse capturado (mira en el centro); label: lo que se apunta (o null)
    setAim({ show, locked, label, x, y }) {
      aim.style.display = show && locked ? 'block' : 'none';
      aim.classList.toggle('on', Boolean(label));
      if (show && label) {
        aimLabel.textContent = label;
        aimLabel.style.display = 'block';
        aimLabel.style.left = `${locked ? window.innerWidth / 2 : x}px`;
        aimLabel.style.top = `${locked ? window.innerHeight / 2 : y}px`;
      } else aimLabel.style.display = 'none';
    },
    flashStrike() {
      strike.style.transition = 'none';
      strike.style.opacity = '1';
      requestAnimationFrame(() => {
        strike.style.transition = 'opacity .8s';
        strike.style.opacity = '0';
      });
    },
    // Lecturas del visor: el pulso sube con el peligro (pocos segundos o muchos errores)
    update(dt, gs) {
      lastReadout += dt;
      if (lastReadout < 0.5 || !gs) return;
      lastReadout = 0;
      const danger = !gs.isOver && (gs.timeLeft <= 30 || gs.strikes >= 2);
      overlay.classList.toggle('danger', danger);
      const target = 76 + gs.strikes * 14 + (gs.timeLeft <= 30 ? 22 : gs.timeLeft <= 60 ? 10 : 0);
      hr += (target - hr) * 0.3 + (Math.random() - 0.5) * 2;
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
      };
      set('hHR', Math.round(hr));
      set('hO2', `${Math.max(90, 98 - gs.strikes)}%`);
      set('hCO2', `${(0.4 + gs.strikes * 0.15).toFixed(1).replace('.', ',')}%`);
      set('hSuit', gs.strikes >= 2 ? 'ALERTA' : 'NOMINAL');
    }
  };
}
