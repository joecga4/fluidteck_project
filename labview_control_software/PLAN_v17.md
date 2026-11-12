# Plan de la VI v17 — estructura por tiempo y riesgo

Decisiones aceptadas por el laboratorio el 2026-11-12:

1. El lazo digital se fusiona en el lazo de control: un solo **lazo de máquina** es dueño del cDAQ.
2. La interfaz entre lazos y nodos son **arreglos numéricos** (`C`, `E`, …), no cables sueltos.
3. El diagrama se **rehace lazo por lazo sobre una copia** que conserva el panel (v17). La v16
   (con `PID.c` v18) queda intacta como respaldo y referencia.
4. Prioridad a los **Formula Node** (texto versionado y probado fuera del equipo) y a los scripts
   para todo lo que no corre dentro del lazo de 20 ms.

Regla de la estructura: los lazos se separan por **tiempo y riesgo** (lo que debe ser puntual y
seguro frente a lo que puede bloquearse); los temas (sensores, UPH, control) se separan en
**textos**, uno por Formula Node.

---

## 1. Estructura

```
ARRANQUE   reservar cDAQ -> crear tareas AI, AO, DI, DO -> AO = u_seguro, DO = patron seguro

LAZO DE MAQUINA (20 ms; lo marca la lectura AI de 4000 muestras a 200 kS/s)
   AI (2D) -> [ENTRADAS] -> M --+
   DI      -> [UPH]      -> G --+--> [PID] -> u -> AO
   C (Tag) ->   |               |      |
                +--> O -> DO           +--> E -> Tag (interfaz) y Stream (registro)

CIERRE     AO = u_seguro, bomba apagada -> parar y liberar tareas

LAZO DE INTERFAZ (100 ms)   panel -> C        E -> indicadores y graficos
LAZO DE REGISTRO            E (Stream) -> archivo de control (abierto una vez por ensayo)
MODULO QUANTUMX (opcional)  driver HBM -> archivo del ensayo
```

| Pieza | Hace | No hace |
|---|---|---|
| Lazo de máquina | todo el cDAQ y toda decisión de seguridad | panel, archivos, Property Node, globales |
| Lazo de interfaz | panel, gráficos, habilitar/ocultar controles | tocar hardware |
| Lazo de registro | archivos | decidir nada |
| Módulo QuantumX | deflexión (W100), Temposonic y celda vía Krenel a 50 Hz | condicionar el arranque del resto |

Comunicación entre lazos: solo canales. `C` y `E` por canal Tag (último valor); `E` hacia el
registro por canal Stream (sin pérdidas). Desaparecen las globales `Ensayando`, `F_QX`, `tQX` y
las lecturas directas del panel dentro del lazo de máquina.

---

## 2. Formula Nodes del lazo de máquina

| Nodo | Archivo | Entradas | Salidas |
|---|---|---|---|
| ENTRADAS | `Entradas.c` | `V` (2D, 4 × N voltios) | `M` |
| UPH | `Uph.c` | `D` (8 DI como 0/1), `C`, `Gp` (su salida anterior) | `O` (8 DO como 0/1), `G` |
| PID | `Pid.c` | `M`, `G`, `C`, `S`, `tr` (reloj del PC, solo diagnóstico) | `u`, `So`, `E` |

`Pid.c` absorbe a `ParamPID.c` (código de acceso y ganancias llegan en `C`) y las realimentaciones
`st`, `f0`, `ts` e `ini` (pasan a `S`).

### M — medidas (ENTRADAS → PID)
| i | Señal | |
|---|---|---|
| 0 | x [mm] | `15·V0` |
| 1 | F [kN] | `20·V1` |
| 2 | pa [bar] | `(V2 − 1.9826)·12.5` |
| 3 | pb [bar] | `(V3 − 1.9682)·50` |
| 4 | ok | 1 = posición y fuerza válidas (hay muestras, sin NaN, dentro de rango) |
| 5 | aviso | 0 ninguno · 1 presión A fuera de rango · 2 presión B · 3 ambas (lazo 4–20 mA abierto: V < 1.5 V) |
| 6 | dt [s] | muestras leídas / 200 000 (20 ms exactos: la base de tiempo del control) |

### G — UPH y seguridad (UPH → PID)
| i | Señal | Origen |
|---|---|---|
| 0 | seta | DI0 (1 = segura) |
| 1 | bomba en marcha | DI7 (hoy se lee y no se usa) |
| 2 | orden de bomba | enclavamiento Encender/Apagar, con **prioridad al apagado** |
| 3 | nivel de aceite | DI1 (1 = OK) |
| 4 | filtro | DI2 (1 = limpio) |
| 5 | guardamotor | DI5 (1 = disparado o apagado) |
| 6 | salir | petición de cierre ordenado (botón Stop) |

`O` (DO): `O[0]` = orden de bomba, `O[2]` = seta pulsada o salida (como hoy «salida contactor2»),
`O[5]` = 1 (alimentación de los transductores), resto 0.

### C — comandos (interfaz → máquina)
| i | Señal | i | Señal |
|---|---|---|---|
| 0 | modo (0 desplazamiento, 1 fuerza) | 10 | límite de fuerza [kN] |
| 1 | iniciar ensayo | 11 | rampa [mm/min] |
| 2 | PARO del panel | 12 | rampa [kN/min] |
| 3 | encender (pulso) | 13 | tiempo de carga [s] |
| 4 | apagar (pulso) | 14 | velocidad de aproximación [mm/min] |
| 5 | salir (Stop) | 15 | Fmax fuera de ensayo [kN] |
| 6 | sin protección de carga | 16 | código de acceso |
| 7 | posición deseada [mm] | 17 | Kx [V/mm] |
| 8 | fuerza deseada [kN] | 18 | Tix [s] |
| 9 | límite de posición [mm] | 19 | Kf [1/s] |
|   |   | 20 | latido de la interfaz (contador) |

### E — estado (máquina → interfaz y registro)
Los 15 primeros son el `Lg` actual, en el mismo orden (los CSV de control siguen siendo comparables).

| i | Señal | i | Señal |
|---|---|---|---|
| 0 | t del ensayo [s] | 14 | F por presiones [kN] |
| 1 | estado (0–5) | 15 | seta (1 = segura) |
| 2 | consigna | 16 | bomba en marcha |
| 3 | F [kN] | 17 | orden de bomba |
| 4 | x [mm] | 18 | nivel de aceite |
| 5 | x_ref [mm] | 19 | filtro |
| 6 | u [V] | 20 | guardamotor |
| 7 | rigidez [kN/mm] | 21 | carga máxima [kN] |
| 8 | dt [s] | 22 | progreso del mantenimiento [%] |
| 9 | falla | 23 | tiempo restante de carga [s] |
| 10 | causa (6 = bomba detenida) | 24 | parámetros personalizados (1) |
| 11 | protección activa | 25 | aviso de sensores (M[5]) |
| 12 | pa [bar] | 26 | dt medido con el reloj del PC [s] |
| 13 | pb [bar] | 27 | modo |

`S` (estado del PID): los 12 actuales + `st`, `f0`, `ts`, `ini` anterior, `t` del ensayo y `tr`
anterior. Se fija al escribir `Pid.c`.

---

## 3. Qué cambia en el comportamiento (y solo esto)

1. Seta (DI0) y bomba en marcha (DI7) llegan al PID en la misma iteración: seta = PARO; bomba
   detenida = comando seguro y seguimiento, FALLA con causa 6 si hay ensayo en curso.
2. Enclavamiento de la bomba con prioridad al apagado; seta leída cada 20 ms (hoy 500 ms).
3. `ao0` = `u_seguro` al arrancar y al salir.
4. Base de tiempo del control = reloj de muestreo (dt = 20 ms exactos); el reloj del PC queda
   solo como diagnóstico de atrasos.
5. Posición o fuerza inválidas se tratan como hoy el NaN; presión inválida es un aviso (mientras
   el corte por presiones siga desactivado).
6. El registro deja de escribir a disco dentro del lazo de control.

Todo lo demás (máquina de estados del ensayo, cascada fuerza → posición, protecciones, constantes)
debe salir **idéntico** a `PID.c` v18: se comprueba con la prueba diferencial.

---

## 4. Fases

Cada fase termina igual: texto verificado fuera del equipo → cableado en LabVIEW → con LabVIEW
cerrado se lee el diagrama y se compara el texto pegado → se repiten las capturas de referencia.

### Fase 0 — Base de pruebas y referencia (no toca ninguna VI)
- [x] Arnés permanente `pruebas/arnes_pid.js` (prueba diferencial y trayectos con planta sencilla).
- [x] `pruebas/comprueba_vi.ps1`: compara el texto de los Formula Node de una `.vi` con los `.c`.
- [ ] Capturas de referencia en la prensa con la v16 + `PID.c` v18 (§5). Son además la primera
      prueba de la v18 en el equipo.
- [ ] Simulación en lazo cerrado: los `.c` contra el modelo Simulink de la planta.

### Fase 1 — Textos del lazo de máquina
- [ ] `Entradas.c`, `Uph.c`, `Pid.c` con las interfaces de §2.
- [ ] `Pid.c` idéntico a `PID.c` v18 con seta = 1 y bomba = 1 (prueba diferencial con adaptador).
- [ ] Mutantes detectados; trayectos: arranque de bomba con consigna distinta, seta en ensayo,
      bomba que se detiene en ensayo, sensor inválido.

### Fase 2 — Diagrama v17: máquina + interfaz mínima + registro de control
- [ ] Copia de la v16 como v17 conservando el panel; diagrama nuevo: arranque, lazo de máquina,
      cierre, lazo de interfaz (un Build Array hacia `C`, un Index Array desde `E`), registro de `E`.
- [ ] Medir el tiempo por iteración con DI/DO dentro del lazo (objetivo: 20 ms sin atrasos; si
      pesa, DI/DO cada 5 iteraciones).
- [ ] Puesta en marcha por pasos: (a) bomba apagada, comparar lecturas con la v16; (b) bomba en
      marcha sin probeta: PARO, seta, Encender con consigna distinta, Stop; (c) capturas de §5.

### Fase 3 — Módulo QuantumX
- [ ] El registro del QuantumX como módulo aparte; la VI arranca y controla aunque falte la licencia.

### Fase 4 — Interfaz
- [ ] Nodo para velocidades de norma y códigos de habilitación; Property Node solo cuando cambian.
- [ ] Gráficos acotados; retirar residuos («PID fuerza», texto 6 de la lista de causas → «BOMBA
      DETENIDA», «160 kN» escrito a mano, rótulos sueltos).

### Fase 5 — Pendientes de control
- [ ] Reactivar el corte por presiones y bajar `F_corte` (CLAUDE.md §5 y §6).
- [ ] Latido de la interfaz; cuenta atrás de los 3 min de calentamiento.
- [ ] Seta cableada en serie con KM1 (electricista).

---

## 5. Capturas de referencia (v16 + `PID.c` v18)

Sin probeta salvo R4. Alguien junto a la seta. Bomba en marcha ≥ 3 min. Guardar los
`*_control.csv` en `results/referencia_v18/` con el nombre de la maniobra.

| | Maniobra | Qué se mira |
|---|---|---|
| R1 | Ensayo de desplazamiento 60 → 70 mm, 30 mm/min, 5 s de carga | rampa, mantenimiento, descarga, retorno; tiempo por iteración |
| R2 | Ensayo de desplazamiento 60 → 62 mm, 1.5 mm/min, 5 s | seguimiento a velocidad de norma (losa) |
| R3 | R1 con PARO a media rampa, 10 s, y soltar | `u` = −0.5 V, el vástago sube ~3 mm/min, sin salto al soltar |
| R4 | Ensayo de fuerza contra la viga de acero: 20 kN, 60 kN/min, 10 s | cascada de fuerza, rigidez estimada, descarga |
| R5 | Anotar «time/iteration (ms)» en reposo y en ensayo | debe estar en ~20 ms (el panel tiene guardado 210) |

---

## 6. Por confirmar al cablear

- Qué hace el relé de DO2 («salida contactor2», activo con seta o Stop): CLAUDE.md lo tiene sin identificar.
- Acción mecánica de Encender, Apagar e Iniciar (pulso o interruptor).
- Costo de leer DI y escribir DO cada 20 ms por Ethernet.
- Costo de promediar 4 × 4000 muestras dentro del Formula Node frente a `Mean.vi`.

---

## 7. Dónde quedamos (cierre del 2026-11-12)

- La v16 guardada a las 16:59 contiene `PID.c` v18 y `ParamPID.c` (comprobado con
  `pruebas/comprueba_vi.ps1`). **La v18 todavía no se ha probado en la prensa.**
- Fase 0: hechos el arnés y el comprobador de texto. **Pendiente del laboratorio:** capturas
  R1–R5 (§5) en `results/referencia_v18/`.
- **Siguiente paso (no depende de las capturas):** fase 1, escribir y verificar `Entradas.c`,
  `Uph.c` y `Pid.c`; después la simulación en lazo cerrado con el modelo Simulink.
- `pruebas/borrador_PID_v19.c`: borrador sin verificar de la v18 con las entradas `seta` y `uph`
  (FALLA con causa 6 si la bomba se detiene en ensayo; comando seguro y seguimiento con la bomba
  parada). Referencia para la lógica de `Pid.c`; no pegar.
- `docs/vi_v16_2026-11-12/` (sin versionar): diagrama completo de la v16, panel, los 16 marcos
  ocultos, mosaicos legibles y todos los textos. Sirve de guía para recablear sin regenerarlo.
- Lectura del lazo digital actual (para `Uph.c`): `ok` = DI0 y no Stop; reset = no `ok`, o Apagar,
  o PARO; DO0 = enclavamiento; DO2 = no `ok`; DO5 = 1. Indicadores: «Estado de motor» = la orden
  (no DI7), «UPH energizada» = no DI5, «Sobrecorriente» = DI5, «Nivel tanque» = DI1,
  «Estado de filtro» = no DI2. DI7 se lee y no se cablea a nada.

