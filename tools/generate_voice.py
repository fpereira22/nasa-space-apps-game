"""
Genera los avisos de voz de la computadora de la nave (public/voice/*.mp3).

Dos motores:
  azure       voces neuronales de Microsoft Azure vía edge-tts (gratis, sin clave).
              Voz por defecto: es-ES-ElviraNeural (mujer, español de España). Otra: es-ES-XimenaNeural.
  elevenlabs  ElevenLabs (modelo eleven_multilingual_v2). Necesita la variable ELEVENLABS_API_KEY
              (la clave NO se guarda en el proyecto). El plan free da ~10.000 caracteres al mes;
              regenerar todo gasta ~1.000.

    pip install edge-tts
    python tools/generate_voice.py                      # genera solo los que faltan (Azure, Elvira)
    python tools/generate_voice.py --force              # regenera todos
    python tools/generate_voice.py --voice es-ES-XimenaNeural --force

    # PowerShell:  $env:ELEVENLABS_API_KEY = "sk_..."
    # Git Bash:    export ELEVENLABS_API_KEY=sk_...
    python tools/generate_voice.py --engine elevenlabs --voice EXAVITQu4vr4xnSDxMaL --force

Para cambiar una frase: edítala en LINES y vuelve a correr con --force.
Los ids los usa public/voice.js (no cambiarlos sin cambiarlos allá también).
También se escribe public/voice/lines.json con los textos (se muestran como subtítulos).
"""
import argparse
import asyncio
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "voice"

LINES = {
    # --- Cronómetro ---
    "start": "Atención: fallo crítico en el reactor. Tienes tres minutos para reparar la nave.",
    "t120": "Faltan dos minutos.",
    "t90": "Quedan noventa segundos.",
    "t60": "Falta un minuto.",
    "t30": "Treinta segundos. Situación crítica.",
    "t20": "Veinte segundos.",
    "n10": "Diez.",
    "n9": "Nueve.",
    "n8": "Ocho.",
    "n7": "Siete.",
    "n6": "Seis.",
    "n5": "Cinco.",
    "n4": "Cuatro.",
    "n3": "Tres.",
    "n2": "Dos.",
    "n1": "Uno.",
    # --- Aciertos ---
    "good1": "¡Bien hecho!",
    "good2": "¡Excelente trabajo!",
    "good3": "¡Perfecto, sigue así!",
    "mod_wires": "Sala de energía estable. Cables reparados.",
    "mod_button": "Núcleo del reactor estabilizado.",
    "mod_simon": "Escudo térmico restaurado.",
    "mod_keypad": "Fase sintonizada. Comunicaciones restablecidas.",
    "left3": "Quedan tres módulos.",
    "left2": "Quedan dos módulos.",
    "left1": "Solo queda un módulo. ¡Ya casi lo tienes!",
    # --- Errores (strikes) ---
    "strike1": "¡Error! Te quedan dos strikes.",
    "strike2": "¡Error! Solo te queda un strike. Un fallo más y perdemos la nave.",
    "strike3": "Tercer error. El reactor ha colapsado.",
    # --- Fin de partida ---
    "timeout": "Tiempo agotado. Fallo total del reactor.",
    "victory": "Todos los sistemas estabilizados. Misión cumplida, astronauta. Buen trabajo.",
}


def is_countdown(key):
    # Los números de la cuenta regresiva van más rápido para que quepan en 1 segundo
    return key[0] == "n" and key[1:].isdigit()


async def azure_tts(key, text, voice, path):
    import edge_tts

    rate = "+25%" if is_countdown(key) else "+6%"
    await edge_tts.Communicate(text, voice, rate=rate).save(str(path))


def elevenlabs_tts(key, text, voice, path):
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("Falta la variable de entorno ELEVENLABS_API_KEY")
    body = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.55,
            "similarity_boost": 0.8,
            "style": 0.15,
            "speed": 1.15 if is_countdown(key) else 1.03,
        },
    }
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps(body).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
    )
    try:
        path.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ElevenLabs respondió {e.code}: {e.read()[:300]!r}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["azure", "elevenlabs"], default="azure")
    ap.add_argument("--voice", help="Azure: nombre de la voz · ElevenLabs: voice_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*", help="generar solo estos ids")
    args = ap.parse_args()
    voice = args.voice or ("es-ES-ElviraNeural" if args.engine == "azure" else "EXAVITQu4vr4xnSDxMaL")

    OUT.mkdir(parents=True, exist_ok=True)
    for key, text in LINES.items():
        if args.only and key not in args.only:
            continue
        path = OUT / f"{key}.mp3"
        if path.exists() and not args.force:
            continue
        if args.engine == "azure":
            await azure_tts(key, text, voice, path)
        else:
            elevenlabs_tts(key, text, voice, path)
        print(f"{key:10s} {path.stat().st_size:6d} B  {text}")

    (OUT / "lines.json").write_text(json.dumps(LINES, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Listo: {len(LINES)} avisos en {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
