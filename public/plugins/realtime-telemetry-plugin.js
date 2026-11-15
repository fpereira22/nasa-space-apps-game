/**
 * Plugin de tiempo real: abre un WebSocket a /realtime y se suscribe
 * ("subscribe <id>") a cada medición que Open MCT esté mostrando.
 * Se reconecta solo si el servidor se reinicia.
 */
(function () {
  window.AetherRealtimeTelemetryPlugin = function AetherRealtimeTelemetryPlugin() {
    return function install(openmct) {
      const listeners = {}; // id -> [callback]
      let socket;
      let retryMs = 1000;

      function send(text) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(text);
        }
      }

      function connect() {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${protocol}://${location.host}/realtime`);

        socket.onopen = () => {
          retryMs = 1000;
          // Re-suscribir todo lo que estaba abierto antes de una reconexión
          Object.keys(listeners).forEach((id) => send(`subscribe ${id}`));
        };
        socket.onmessage = (event) => {
          const point = JSON.parse(event.data);
          (listeners[point.id] || []).forEach((cb) => cb(point));
        };
        socket.onclose = () => {
          setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 15000);
        };
      }

      connect();

      openmct.telemetry.addProvider({
        supportsSubscribe(domainObject) {
          return domainObject.type === 'aether.telemetry';
        },
        subscribe(domainObject, callback) {
          const id = domainObject.identifier.key;
          if (!listeners[id]) {
            listeners[id] = [];
            send(`subscribe ${id}`);
          }
          listeners[id].push(callback);

          return function unsubscribe() {
            listeners[id] = (listeners[id] || []).filter((cb) => cb !== callback);
            if (listeners[id].length === 0) {
              delete listeners[id];
              send(`unsubscribe ${id}`);
            }
          };
        }
      });
    };
  };
})();
