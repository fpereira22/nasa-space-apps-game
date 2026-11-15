/**
 * Radio de voz "mantener para hablar" (push-to-talk) entre el astronauta y control en tierra.
 * La usan tablero.html (astronauta) y chat.html (control en tierra, dentro de Open MCT).
 *
 * Cómo funciona:
 *  - El audio viaja DIRECTO entre navegadores con WebRTC (en malla: cada uno con todos).
 *  - server.js (ws /rtc) solo presenta a los participantes y reenvía la negociación.
 *  - El micrófono queda SILENCIADO salvo mientras se mantiene presionado el botón (o la tecla T).
 *  - El navegador solo da acceso al micrófono en https:// o en localhost. Desde otro computador
 *    hay que abrir la versión https (puerto 8443).
 *
 * Uso:
 *   const radio = new AetherRadio({ url: 'wss://host/rtc', role: 'TIERRA', getName: () => 'Ana', onChange });
 *   await radio.enable();      // pide el micrófono y entra a la radio (llamar desde un clic)
 *   radio.setTalking(true);    // empezar a transmitir; false para soltar
 *   radio.state                // 'off' | 'connecting' | 'ready' | 'listen' (sin micrófono) | 'error'
 *   radio.talkers()            // [{ role, name }] que están hablando ahora
 */
(function () {
  const ROLE_LABEL = { ASTRONAUTA: 'ASTRONAUTA', TIERRA: 'TIERRA' };

  class AetherRadio {
    constructor({ url, role, getName = () => '', onChange = () => {} }) {
      this.url = url;
      this.role = role;
      this.getName = getName;
      this.onChange = onChange;

      this.state = 'off';
      this.error = '';
      this.micError = '';
      this.talking = false;
      this.stream = null;
      this.track = null;
      this.ws = null;
      this.myId = null;
      this.peers = new Map(); // id -> { pc, info, pending: [], audio }
      this.speaking = new Map(); // id -> { role, name }
      this.audioCtx = null;
      this.retryMs = 1000;
    }

    // ---------------------------------------------------------------- público
    async enable() {
      if (this.state !== 'off' && this.state !== 'error') return;
      this.setState('connecting');
      try {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this.audioCtx = null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.micError = window.isSecureContext
          ? 'Este navegador no permite usar el micrófono.'
          : `Para hablar desde otro computador abre https://${location.hostname}:8443${location.pathname}`;
      } else {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
          this.track = this.stream.getAudioTracks()[0];
          this.track.enabled = false; // silenciado hasta presionar
        } catch (e) {
          this.micError = 'No se dio permiso para usar el micrófono: solo puedes escuchar.';
        }
      }
      this.connect();
    }

    setTalking(on) {
      on = Boolean(on);
      if (!this.track || this.state !== 'ready' || on === this.talking) return false;
      this.talking = on;
      this.track.enabled = on;
      this.send({ type: 'talking', on });
      this.beep(on ? 1200 : 700, 0.06);
      this.onChange(this);
      return true;
    }

    talkers() {
      return [...this.speaking.values()];
    }

    peerCount() {
      return this.peers.size;
    }

    static label(t) {
      return `${ROLE_LABEL[t.role] || t.role}${t.name ? ' · ' + t.name : ''}`;
    }

    // ---------------------------------------------------------------- señalización
    connect() {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        this.fail('No se pudo conectar con el servidor de radio.');
        return;
      }
      this.ws.onopen = () => {
        this.retryMs = 1000;
        this.send({ type: 'join', role: this.role, name: this.getName() });
      };
      this.ws.onmessage = (event) => this.onMessage(JSON.parse(event.data));
      this.ws.onclose = () => {
        this.closeAllPeers();
        if (this.state === 'off') return;
        this.setState('connecting');
        setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 15000);
      };
      this.ws.onerror = () => {};
    }

    send(payload) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    }

    async onMessage(msg) {
      if (msg.type === 'welcome') {
        this.myId = msg.id;
        this.setState(this.track ? 'ready' : 'listen');
        // El que llega inicia la conexión con cada uno de los que ya estaban
        msg.peers.forEach((p) => this.createPeer(p, true));
      } else if (msg.type === 'peer-joined') {
        this.createPeer(msg, false);
        this.onChange(this);
      } else if (msg.type === 'peer-left') {
        this.closePeer(msg.id);
        if (this.speaking.delete(msg.id)) this.onChange(this);
        this.onChange(this);
      } else if (msg.type === 'signal') {
        await this.onSignal(msg.from, msg.data);
      } else if (msg.type === 'talking') {
        if (msg.on) this.speaking.set(msg.id, { role: msg.role, name: msg.name });
        else this.speaking.delete(msg.id);
        this.beep(msg.on ? 900 : 600, 0.05); // "chasquido" de radio
        this.onChange(this);
      }
    }

    // ---------------------------------------------------------------- WebRTC
    createPeer(info, initiator) {
      if (this.peers.has(info.id)) return this.peers.get(info.id);
      // Red local: no hace falta servidor STUN/TURN
      const pc = new RTCPeerConnection({ iceServers: [] });
      const peer = { pc, info, pending: [], audio: null };
      this.peers.set(info.id, peer);

      pc.onicecandidate = (e) => {
        if (e.candidate) this.send({ type: 'signal', to: info.id, data: { candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        if (!peer.audio) {
          peer.audio = document.createElement('audio');
          peer.audio.autoplay = true;
          peer.audio.style.display = 'none';
          document.body.appendChild(peer.audio);
        }
        peer.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
        peer.audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => this.onChange(this);

      if (initiator) {
        const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
        if (this.track) transceiver.sender.replaceTrack(this.track);
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => this.send({ type: 'signal', to: info.id, data: { sdp: pc.localDescription } }))
          .catch((e) => console.warn('[radio] oferta', e));
      }
      return peer;
    }

    async onSignal(from, data) {
      const peer = this.peers.get(from) || this.createPeer({ id: from }, false);
      const { pc } = peer;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            // Usar el transceptor que trae la oferta (no crear otro)
            const transceiver = pc.getTransceivers()[0];
            if (transceiver) {
              transceiver.direction = 'sendrecv';
              if (this.track) await transceiver.sender.replaceTrack(this.track);
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.send({ type: 'signal', to: from, data: { sdp: pc.localDescription } });
          }
          for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c);
        } else if (data.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else peer.pending.push(data.candidate);
        }
      } catch (e) {
        console.warn('[radio] señal', e);
      }
    }

    closePeer(id) {
      const peer = this.peers.get(id);
      if (!peer) return;
      peer.pc.close();
      if (peer.audio) peer.audio.remove();
      this.peers.delete(id);
    }

    closeAllPeers() {
      [...this.peers.keys()].forEach((id) => this.closePeer(id));
      this.speaking.clear();
    }

    // ---------------------------------------------------------------- utilidades
    setState(state) {
      this.state = state;
      if (state !== 'ready' && this.talking) {
        this.talking = false;
        if (this.track) this.track.enabled = false;
      }
      this.onChange(this);
    }

    fail(message) {
      this.error = message;
      this.setState('error');
    }

    beep(freq, duration) {
      const ctx = this.audioCtx;
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.03, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch (e) {}
    }
  }

  // Conecta un botón "mantener para hablar" + tecla T (si no se está escribiendo)
  AetherRadio.bindPushToTalk = function (radio, button) {
    const start = (e) => {
      e.preventDefault();
      radio.setTalking(true);
    };
    const stop = () => radio.setTalking(false);
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('contextmenu', (e) => e.preventDefault());

    const typing = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
    window.addEventListener('keydown', (e) => {
      if ((e.key === 't' || e.key === 'T') && !e.repeat && !typing(e)) radio.setTalking(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 't' || e.key === 'T') radio.setTalking(false);
    });
    window.addEventListener('blur', stop); // si se cambia de ventana, deja de transmitir
  };

  window.AetherRadio = AetherRadio;
})();
