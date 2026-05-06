# Matta Fire - Monitor de Incendios Forestales de Chile

Sistema de monitoreo de incendios forestales en tiempo real para Chile, con datos satelitales de NASA FIRMS y alertas basadas en criterios de CONAF.

**Hecho con amor desde Concon, Chile.**

---

## Caracteristicas

- **Actualizacion cada minuto** - El monitor refresca datos satelitales cada minuto (FIRMS puede tener retraso)
- **Historial de 24 horas** - Seguimiento de focos con deduplicacion inteligente
- **Clasificacion de severidad** - Incendios categorizados como menor, moderado, significativo o mayor
- **Indice de Clima de Fuego (FWI)** - Calculo del riesgo de propagacion
- **Capa de vegetacion** - Visualizacion de cobertura vegetal (ESA WorldCover)
- **Viento por ubicacion** - Datos de viento para cada foco de incendio
- **Niveles de riesgo regional** - Basado en estadisticas historicas de CONAF
- **WebSocket en vivo** - Actualizaciones push sin recargar pagina
- **Modo claro/oscuro** - Interfaz adaptable
- **Exportacion de datos** - CSV y GeoJSON

---

## Fuentes de Datos

| Fuente | Datos | Actualizacion |
|--------|-------|---------------|
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | Detecciones de incendios (VIIRS/MODIS) | Cada 1 minuto (puede tener retraso satelital) |
| [Open-Meteo](https://open-meteo.com/) | Clima y viento | Cada hora |
| [ESA WorldCover](https://esa-worldcover.org/) | Cobertura vegetal (10m resolucion) | Anual |
| [CONAF](https://www.conaf.cl/) | Criterios de riesgo | Referencia solo (no hay feed en vivo) |

### Atribuciones

- Datos de incendios: NASA FIRMS (Fire Information for Resource Management System)
- Datos meteorologicos: Open-Meteo API
- Cobertura vegetal: © ESA WorldCover project 2020
- Estadisticas de riesgo: Basado en datos publicos de CONAF (2002-2025)
- Mapas base: © CARTO

---

## Tecnologias

### Backend
- **Go** - Lenguaje de programacion
- **Huma v2** - Framework REST API
- **WebSocket** - Actualizaciones en tiempo real
- **Cache en memoria** - Historial de 24 horas

### Frontend
- **React 18** - Interfaz de usuario
- **Vite** - Build tool
- **Leaflet** - Mapas interactivos
- **react-leaflet** - Componentes React para Leaflet

---

## Instalacion

### Requisitos
- Go 1.21+
- Node.js 18+
- npm o yarn

### Backend

```bash
cd backend
go mod download
go build -o server .
./server
```

El servidor inicia en:
- API REST: `http://localhost:8081`
- WebSocket: `ws://localhost:8081/ws`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

La aplicacion inicia en `http://localhost:3000`

### Variables de Entorno

```
NASA_FIRMS_API_KEY=tu_api_key_aqui
PORT=8081
```

Obtener API key de NASA FIRMS en: https://firms.modaps.eosdis.nasa.gov/api/area/

---

## Uso

### Controles del Mapa

| Boton | Funcion |
|-------|---------|
| **Calor** | Activa mapa de calor de intensidad |
| **Vegetacion** | Muestra capa de cobertura vegetal |
| **Clusters** | Agrupa marcadores cercanos |
| **CSV** | Exporta datos en formato CSV |
| **GeoJSON** | Exporta datos en formato GeoJSON |

### Filtros Disponibles

- **Satelite** - VIIRS NOAA-20, VIIRS SNPP, MODIS
- **Confianza** - Alta, Nominal (detecciones de baja confianza se filtran automaticamente)
- **Intensidad** - Extrema, Alta, Media, Baja (basada en FRP)
- **Momento** - Dia, Noche
- **Region** - Todas las regiones de Chile
- **FRP** - Rango de potencia radiativa

### Interpretacion de Colores

#### Marcadores de Incendio
| Color | FRP (MW) | Intensidad |
|-------|----------|------------|
| Rojo | ≥100 | Muy alta |
| Naranja oscuro | ≥50 | Alta |
| Naranja | ≥20 | Media |
| Naranja claro | ≥10 | Baja |
| Amarillo | <10 | Muy baja |

#### Severidad del Incendio
| Icono | Nivel | Descripcion |
|-------|-------|-------------|
| 🔴 | Mayor | Multiples detecciones, alta intensidad, larga duracion |
| 🟠 | Significativo | Varias detecciones o alta intensidad |
| 🟡 | Moderado | Algunas detecciones |
| 🟢 | Menor | Deteccion unica reciente |

#### Riesgo Regional (basado en estadisticas CONAF 2002-2025)
| Region | Nivel |
|--------|-------|
| IX (La Araucania) | Critico |
| VIII (Biobio) | Alto |
| VII (Maule) | Alto |
| V (Valparaiso) | Elevado |
| VI (O'Higgins) | Elevado |
| XVI (Nuble) | Elevado |
| RM (Metropolitana) | Moderado |

---

## API Endpoints

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/fires` | GET | Obtener todos los focos activos |
| `/api/stats` | GET | Estadisticas de incendios |
| `/api/major-fires` | GET | Solo incendios mayores/significativos |
| `/api/regions` | GET | Lista de regiones de Chile |
| `/api/wind` | GET | Datos de viento por coordenadas |
| `/api/fwi` | GET | Indice de Clima de Fuego |
| `/api/export` | GET | Exportar datos (formato=csv/geojson) |
| `/ws` | WS | WebSocket para actualizaciones en vivo |

---

## Indicadores de Vigilancia

### Horario de Riesgo Elevado
- **Horario**: 13:00 - 19:00
- Periodo historico con mayor ocurrencia de incendios segun estadisticas CONAF

### Viento Alto
- **Umbral informativo**: >=20 km/h en focos activos en Chile
- Este indicador es informativo y no equivale a una alerta oficial CONAF

---

## Estructura del Proyecto

```
wildfire-monitor/
├── backend/
│   ├── main.go          # Servidor principal y endpoints
│   ├── fwi.go           # Calculo del Fire Weather Index
│   ├── history.go       # Historial y deduplicacion de incendios
│   ├── types.go         # Estructuras de datos
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Componente principal
│   │   ├── App.css      # Estilos globales
│   │   ├── Map.jsx      # Componente del mapa
│   │   ├── FilterPanel.jsx
│   │   ├── TimeSlider.jsx
│   │   └── FWIPanel.jsx
│   ├── package.json
│   └── vite.config.js
└── README.md
```

---

## Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Haz fork del repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcion`)
3. Commit tus cambios (`git commit -m 'Agrega nueva funcion'`)
4. Push a la rama (`git push origin feature/nueva-funcion`)
5. Abre un Pull Request

---

## Licencia

Este proyecto esta licenciado bajo la **Licencia MIT** - ver el archivo [LICENSE](LICENSE) para mas detalles.

---

## Creditos

- Desarrollado con la asistencia de [Claude](https://claude.ai) (Anthropic)
- Datos satelitales proporcionados por NASA FIRMS
- Datos de vegetacion por ESA WorldCover
- Inspirado en el trabajo de CONAF protegiendo los bosques de Chile

---

**Hecho con amor desde Concon, Chile**
