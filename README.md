# Pósters de maratón

Aplicación web estática que dibuja el recorrido oficial de una maratón o media maratón sobre la trama de su ciudad (calles por jerarquía, agua, parques y vías) y exporta el póster listo para imprenta.

## Qué exporta

- **PDF vectorial** a tamaño físico (A4 a 70 × 100 cm), con sangrado de 3 mm y marcas de corte opcionales. El texto va convertido a curvas, así que el archivo no depende de fuentes instaladas.
- **SVG** con la misma geometría.
- **PNG** a 150, 200 o 300 dpi, con la resolución escrita en el archivo.

El PDF sale en RGB; la conversión a CMYK queda del lado de la imprenta. En pantalla, la guía rosa marca el corte y la celeste la zona segura de 10 mm. La app avisa cuando una línea queda por debajo de 0.1 mm o el contraste entre texto y fondo baja de 3:1.

## Uso local

```bash
python3 -m http.server 8765
# http://localhost:8765
```

Arrastrar el mapa encuadra, la rueda acerca y aleja. El diseño queda guardado en la URL: copiar el link reproduce el póster.

## Datos

`data/races.json` lista las carreras. Cada una tiene su recorrido en `data/courses/<id>.geojson` y su ciudad en `data/cities/<id>.topo.json`.

Para agregar o regenerar una carrera:

```bash
uv venv .venv && uv pip install -p .venv -r scripts/requirements.txt
npm install
cd scripts
../.venv/bin/python build_course.py --race <id>   # recorrido, ajustado a las calles
../.venv/bin/python fetch_osm.py --race <id>      # ciudad desde el extracto OSM
cd .. && node scripts/to_topo.mjs <id>             # TopoJSON para el navegador
```

- `build_course.py` acepta GPX, GeoJSON, una traza existente o puntos de giro. Las trazas se ajustan a la red de calles de OpenStreetMap con map matching (Viterbi sobre un grafo sin restricciones de mano única, porque las calles van cortadas). Las marcas de km se ubican escalando la longitud GPS a la distancia oficial (`distance_km`, 42.195 por defecto; 21.0975 en medias maratones).
- `fetch_osm.py` lee extractos de BBBike o Geofabrik (cacheados en `data/raw/pbf/`) y simplifica cada capa con una tolerancia de 3 a 6 m, muy por debajo de lo que se ve en un 70 × 100.
- `debug_course.py` dibuja recortes del recorrido sobre las calles para revisarlo a ojo.

## Límites

El recorrido es una reconstrucción a partir de la fuente anotada en cada carrera (`course.source`). Puede apartarse unos metros del trazado medido en rampas, puentes de dos niveles y rotondas, y no sirve como referencia de distancia: la longitud dibujada se ajusta por escala a la distancia oficial.

## Créditos

Mapa © colaboradores de OpenStreetMap, bajo licencia ODbL. Tipografías de Google Fonts bajo SIL Open Font License. Librerías: D3, topojson-client, opentype.js, jsPDF y svg2pdf.js.
