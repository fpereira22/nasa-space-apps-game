/**
 * Plugin de diccionario: crea en el árbol de Open MCT la carpeta "U.S.S. Aether" con:
 *   - "Consola del experto": un Display Layout ya armado (no hay que construirlo a mano)
 *   - "Manual de reparación": /manual.html embebido como página web
 *   - "Radio y chat con el astronauta": /chat.html embebido como página web (también va en la consola)
 *   - una entrada por cada medición definida en /dictionary.json
 * (Mismo patrón que el tutorial oficial: github.com/nasa/openmct-tutorial)
 *
 * La consola es de solo lectura (no se guarda en ningún lado). Para personalizarla:
 * clic derecho -> Duplicate -> dentro de "My Items", y editar la copia.
 */
(function () {
  const NAMESPACE = 'aether.taxonomy';
  const ROOT_KEY = 'spacecraft';
  const CONSOLE_KEY = 'console';
  const MANUAL_KEY = 'manual';
  const CHAT_KEY = 'chat';
  let dictionaryPromise;

  // Páginas propias que se muestran dentro de Open MCT (tipo "webPage")
  const WEB_PAGES = {
    [MANUAL_KEY]: { name: 'Manual de reparación', url: '/manual.html' },
    [CHAT_KEY]: { name: 'Radio y chat con el astronauta', url: '/chat.html' }
  };

  function getDictionary() {
    if (!dictionaryPromise) {
      dictionaryPromise = fetch('/dictionary.json').then((r) => r.json());
    }
    return dictionaryPromise;
  }

  function id(key) {
    return { namespace: NAMESPACE, key };
  }

  // ---------------------------------------------------------------------------
  // Consola del experto (Display Layout). Unidades: celdas de 10 px.
  // ---------------------------------------------------------------------------
  const W = 30; // ancho de cada indicador (3 columnas = 92 celdas ≈ 920 px)
  const H = 4; // alto de cada indicador
  const COL = (n) => n * (W + 1);

  function value(key, x, y) {
    return {
      type: 'telemetry-view',
      id: `aether-${key}`,
      identifier: id(key),
      x,
      y,
      width: W,
      height: H,
      displayMode: 'all',
      value: 'value',
      stroke: '',
      fill: '',
      color: '',
      fontSize: 'default',
      font: 'default'
    };
  }

  function view(key, viewKey, x, y, width, height) {
    return {
      type: 'subobject-view',
      id: `aether-${key}-${viewKey}`,
      identifier: id(key),
      x,
      y,
      width,
      height,
      hasFrame: true,
      fontSize: 'default',
      font: 'default',
      viewKey
    };
  }

  function label(text, x, y, width) {
    return {
      type: 'text-view',
      id: `aether-label-${y}`,
      text,
      x,
      y,
      width,
      height: 3,
      stroke: '',
      fill: '',
      color: '#ffb84d',
      fontSize: '14',
      font: 'default'
    };
  }

  const FULL = 3 * W + 2;

  const CONSOLE_ITEMS = [
    label('ESTADO DE LA MISIÓN', 0, 0, FULL),
    value('aether.timer', COL(0), 3),
    value('aether.strikes', COL(1), 3),
    value('aether.mission', COL(2), 3),

    label('📡 SOLO TÚ VES ESTO — el astronauta no lo tiene en su tablero', 0, 8, FULL),
    value('aether.reactor.temp', COL(0), 11),
    value('aether.phase.polarity', COL(1), 11),
    value('aether.hull', COL(2), 11),

    view('aether.reactor.temp', 'plot-single', COL(0), 16, W, 24),
    view('aether.events', 'table', COL(1), 16, W, 24),
    view(CHAT_KEY, 'webPage', COL(2), 16, W, 44), // columna derecha: radio de voz + chat

    label('MÓDULOS', 0, 41, 2 * W + 1),
    value('aether.mod.wires', COL(0), 44),
    value('aether.mod.button', COL(1), 44),
    value('aether.mod.simon', COL(0), 49),
    value('aether.mod.keypad', COL(1), 49)
  ];

  function consoleObject(identifier) {
    const composition = [];
    const seen = new Set();
    CONSOLE_ITEMS.forEach((item) => {
      if (item.identifier && !seen.has(item.identifier.key)) {
        seen.add(item.identifier.key);
        composition.push(item.identifier);
      }
    });
    return {
      identifier,
      name: 'Consola del experto',
      type: 'layout',
      composition,
      configuration: {
        items: CONSOLE_ITEMS,
        layoutGrid: [10, 10],
        objectStyles: {}
      },
      location: `${NAMESPACE}:${ROOT_KEY}`
    };
  }

  // ---------------------------------------------------------------------------
  // Proveedores
  // ---------------------------------------------------------------------------
  const objectProvider = {
    get(identifier) {
      return getDictionary().then((dictionary) => {
        if (identifier.key === ROOT_KEY) {
          return {
            identifier,
            name: dictionary.name,
            type: 'folder',
            location: 'ROOT'
          };
        }
        if (identifier.key === CONSOLE_KEY) {
          return consoleObject(identifier);
        }
        if (WEB_PAGES[identifier.key]) {
          return {
            identifier,
            name: WEB_PAGES[identifier.key].name,
            type: 'webPage',
            url: WEB_PAGES[identifier.key].url,
            location: `${NAMESPACE}:${ROOT_KEY}`
          };
        }
        const measurement = dictionary.measurements.find((m) => m.key === identifier.key);
        if (!measurement) {
          return undefined;
        }
        return {
          identifier,
          name: measurement.name,
          type: 'aether.telemetry',
          telemetry: { values: measurement.values },
          location: `${NAMESPACE}:${ROOT_KEY}`
        };
      });
    }
  };

  const compositionProvider = {
    appliesTo(domainObject) {
      return domainObject.identifier.namespace === NAMESPACE && domainObject.type === 'folder';
    },
    load() {
      return getDictionary().then((dictionary) => [
        id(CONSOLE_KEY),
        id(MANUAL_KEY),
        id(CHAT_KEY),
        ...dictionary.measurements.map((m) => id(m.key))
      ]);
    }
  };

  window.AetherDictionaryPlugin = function AetherDictionaryPlugin() {
    return function install(openmct) {
      openmct.objects.addRoot(id(ROOT_KEY));
      openmct.objects.addProvider(NAMESPACE, objectProvider);
      openmct.composition.addProvider(compositionProvider);
      openmct.types.addType('aether.telemetry', {
        name: 'Telemetría U.S.S. Aether',
        description: 'Punto de telemetría enviado por el tablero de reparación.',
        cssClass: 'icon-telemetry'
      });
    };
  };
})();
