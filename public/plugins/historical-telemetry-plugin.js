/**
 * Plugin histórico: cuando Open MCT necesita datos de un rango de tiempo
 * (al abrir un gráfico o tabla), los pide a GET /history/:id?start&end.
 */
(function () {
  window.AetherHistoricalTelemetryPlugin = function AetherHistoricalTelemetryPlugin() {
    return function install(openmct) {
      openmct.telemetry.addProvider({
        supportsRequest(domainObject) {
          return domainObject.type === 'aether.telemetry';
        },
        request(domainObject, options) {
          const id = encodeURIComponent(domainObject.identifier.key);
          const url = `/history/${id}?start=${options.start}&end=${options.end}`;
          return fetch(url, { signal: options.signal }).then((r) => r.json());
        }
      });
    };
  };
})();
