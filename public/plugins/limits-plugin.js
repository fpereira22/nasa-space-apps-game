/**
 * Plugin de límites: pinta en amarillo/rojo los valores fuera de rango
 * en tablas, LAD tables y display layouts de Open MCT.
 */
(function () {
  const YELLOW_LOW = { cssClass: 'is-limit--lwr is-limit--yellow', name: 'Advertencia (bajo)' };
  const RED_LOW = { cssClass: 'is-limit--lwr is-limit--red', name: 'Crítico (bajo)' };
  const YELLOW_HIGH = { cssClass: 'is-limit--upr is-limit--yellow', name: 'Advertencia (alto)' };
  const RED_HIGH = { cssClass: 'is-limit--upr is-limit--red', name: 'Crítico (alto)' };

  // Reglas por medición: devuelven un límite o undefined si el valor es nominal
  const RULES = {
    'aether.timer': (v) => (v <= 30 ? RED_LOW : v <= 60 ? YELLOW_LOW : undefined),
    'aether.strikes': (v) => (v >= 2 ? RED_HIGH : v >= 1 ? YELLOW_HIGH : undefined),
    'aether.reactor.temp': (v) => (v >= 1800 ? RED_HIGH : v >= 1400 ? YELLOW_HIGH : undefined),
    'aether.hull': (v) => (v < 40 ? RED_LOW : v < 75 ? YELLOW_LOW : undefined),
    'aether.thrusters': (v) => (v === 1 ? RED_HIGH : undefined),
    'aether.mission': (v) => (v === 2 ? RED_HIGH : undefined),
    'aether.mod.wires': (v) => (v === 0 ? YELLOW_LOW : undefined),
    'aether.mod.button': (v) => (v === 0 ? YELLOW_LOW : undefined),
    'aether.mod.simon': (v) => (v === 0 ? YELLOW_LOW : undefined),
    'aether.mod.keypad': (v) => (v === 0 ? YELLOW_LOW : undefined)
  };

  window.AetherLimitsPlugin = function AetherLimitsPlugin() {
    return function install(openmct) {
      openmct.telemetry.addProvider({
        supportsLimits(domainObject) {
          return domainObject.type === 'aether.telemetry' && Boolean(RULES[domainObject.identifier.key]);
        },
        getLimitEvaluator(domainObject) {
          const rule = RULES[domainObject.identifier.key];
          return {
            evaluate(datum, valueMetadata) {
              if (valueMetadata && valueMetadata.key !== 'value') return undefined;
              return rule(datum.value);
            }
          };
        }
      });
    };
  };
})();
