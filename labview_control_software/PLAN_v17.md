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
| ENTRADAS | `v17/Entradas.c` | `V` (2D, 4 × N voltios) | `M` |
| UPH | `v17/Uph.c` | `D` (8 DI como 0/1), `C`, `Gp` (su salida anterior) | `O` (8 DO como 0/1), `G` |
| PID | `v17/Pid.c` | `M`, `G`, `C`, `S`, `tr` (reloj del PC, solo diagnóstico) | `u`, `So`, `E` |

Los textos van en la subcarpeta `v17/` (Windows no distingue `Pid.c` de `PID.c`). `Pid.c` absorbe a `ParamPID.c` (código de acceso y ganancias llegan en `C`) y las realimentaciones
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
| 7 | pasos sin confirmar | pasos seguidos con orden de bomba y sin DI7; a los 100 (2 s) se retira la orden |

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

`S` (estado del PID, 17): los 12 actuales (el 5 pasa a ser `tr` anterior) + 12 `st`, 13 `f0`,
14 `ts`, 15 `ini` anterior, 16 `t` del ensayo.

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
7. **Arranque sin salto** (aceptado el 2026-11-13): el integrador ya no se pone a cero al iniciar
   un ensayo, al cambiar el tipo de control ni en el PARO; en paro o con la bomba detenida queda
   congelado. El comando arranca en el null aprendido en vez de pasar por 0 V.
8. **Bomba que no confirma** (aceptado el 2026-11-13): si hay orden de bomba y DI7 no confirma
   la marcha durante 2 s, `Uph.c` retira la orden; hay que pulsar Encender de nuevo.

Todo lo demás (máquina de estados del ensayo, cascada fuerza → posición, protecciones, constantes)
debe salir **idéntico** a `PID.c` v18: se comprueba con la prueba diferencial (contra la v18 con
el punto 7 aplicado, que es el único cambio del cuerpo del controlador).

---

## 4. Fases

Cada fase termina igual: texto verificado fuera del equipo → cableado en LabVIEW → con LabVIEW
cerrado se lee el diagrama y se compara el texto pegado → se repiten las capturas de referencia.

### Fase 0 — Base de pruebas y referencia (no toca ninguna VI)
- [x] Arnés permanente `pruebas/arnes_pid.js` (prueba diferencial y trayectos con planta sencilla).
- [x] `pruebas/comprueba_vi.ps1`: compara el texto de los Formula Node de una `.vi` con los `.c`.
- [x] Capturas de referencia en la prensa con la v16 + `PID.c` v18 (§5), 2026-11-13: la v18 queda
      probada en el equipo.
- [ ] Simulación en lazo cerrado: los `.c` contra el modelo Simulink de la planta.

### Fase 1 — Textos del lazo de máquina
- [x] `v17/Entradas.c`, `v17/Uph.c`, `v17/Pid.c` con las interfaces de §2 (2026-11-13).
- [x] `Pid.c` idéntico a `PID.c` v18 + `ParamPID.c` con seta = 1 y bomba en marcha: 800 000 pasos
      (con y sin corte por presiones), 0 diferencias. Seta pulsada ≡ PARO. Bomba detenida: comando
      seguro y seguimiento; FALLA 6 si había ensayo, aviso 6 si no.
- [x] `Uph.c`: las 1024 combinaciones frente a la lógica cableada de la v16; solo cambia el caso
      Encender + apagado en el mismo paso (240 combinaciones: ahora manda el apagado).
- [x] `Entradas.c`: 20 000 casos frente a un cálculo independiente; validez y avisos.
- [x] 20 de 20 mutantes detectados. Trayectos con la cadena completa: los dos ensayos normales
      salen iguales a la v16 (diferencia < 1e-11); con ENCENDER y la consigna a 7 mm, la v16 tiene
      la válvula a +10 V y arranca a 3.6 mm/s, la v17 parte de −0.5 V y sigue la rampa de
      aproximación (máx 1.2 mm/s).
      Todo se repite con `cscript //nologo pruebas\arnes_v17.js todo`.
- [x] Propuestas de §8 aceptadas, aplicadas y verificadas (2026-11-13): 800 000 pasos sin
      diferencias fuera de lo esperado, 26 de 26 mutantes; el comando en el primer paso de un
      ensayo pasa de «null → 0 V» a «null → null».

### Fase 2 — Diagrama v17: máquina + interfaz mínima + registro de control
- [ ] **Guía paso a paso: `v17/GUIA_FASE2.md`.** Copia de la v16 como v17 conservando el panel; diagrama nuevo: arranque, lazo de máquina,
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

### Resultados de referencia (2026-11-13, v16 + `PID.c` v18; archivos en `results/referencia_v18/`)

Los `prueba Pn_control.csv` son el `Lg` (15 columnas, 50 filas/s, solo con ensayo en curso); los
`prueba Pn.csv` son el QuantumX. P1 contiene dos ensayos seguidos (uno a 0.1 mm/min de 15 s y el
de 30 mm/min) y le faltan la cabecera y los primeros 53 s del QuantumX. P1, P2 y P3 se detuvieron
a mano durante la rampa: no tienen mantenimiento, descarga ni retorno.

| | Maniobra real | Resultado |
|---|---|---|
| P1 | posición 50 → 61.5 mm a 30 mm/min | velocidad 30.00 mm/min; error consigna − posición rms 0.001 mm (máx 0.032 mm en el arranque); u ≈ +0.94 V |
| P2 | posición 50 → 52.3 mm a 1.5 mm/min | velocidad 1.50 mm/min; error rms 0.0008 mm, máx 0.007 mm; u ≈ −0.22 V |
| P3 | posición a 10 mm/min y PARO en t = 34.5 s | estado 5, causa 4, **u = −0.500 V exactos** durante 25.8 s; el vástago sube a 3.4 mm/min (2.5 al caer la presión, porque el PARO apaga la bomba: 34.5 → 24 bar); al soltar, u pasa a +0.03 V y vuelve al null en ~1 s con un movimiento de 0.01 mm |
| P4 | fuerza 0.5 → 20 kN a 10 kN/min contra la viga, 30 s, descarga y retorno | rampa 9.91 kN/min; error consigna − fuerza rms 0.09 kN (rampa) y 0.02 kN (mantenimiento); pico 20.06 kN; descarga a 38.9 kN/min; rigidez estimada 13.2–13.6 kN/mm |
| P5 | tiempo por iteración leído en el panel | 19–21 ms |

- **Tiempos del lazo** (columna dt): mediana 20.05 ms; p99 22 ms (30 ms en P3); máximos de
  38–73 ms; pasos de más de 25 ms: 0.05 %–1.4 %. Es la referencia para comparar al sacar el
  registro del lazo de control.
- **Presiones** (cierra el pendiente de comprobar `Lg[12..14]`): en reposo 34.0 / 45.4 bar; la
  fuerza por presiones coincide con la celda a ±0.3 kN en carga y mantenimiento, y queda 1.7 kN
  por debajo durante la descarga (rozamiento al invertir el sentido).
- **Null del día:** −0.35 V al empezar y −0.29 V tres minutos después; −0.26 V sosteniendo 20 kN.
  Con −0.5 V el margen sobre el null fue de 0.15–0.24 V.
- **Hallazgo:** en el primer paso de cada ensayo el comando vale **0.000 V** (el reinicio pone
  `integ = 0`), es decir, salta del null a 0 V y tarda 0.1–0.4 s en volver. Desvío resultante:
  +0.011 mm a 0.1 mm/min (lo que la rampa avanza en casi 7 s), +0.007 mm a 1.5 mm/min y
  −0.032 mm a 30 mm/min. Lo mismo ocurre al soltar el PARO. Propuesta: conservar `integ` (que
  guarda el null aprendido) en vez de ponerlo a cero.

---

## 6. Por confirmar al cablear

- Qué hace el relé de DO2 («salida contactor2», activo con seta o Stop): CLAUDE.md lo tiene sin identificar.
- Acción mecánica de Encender, Apagar e Iniciar (pulso o interruptor).
- Costo de leer DI y escribir DO cada 20 ms por Ethernet.
- Costo de promediar 4 × 4000 muestras dentro del Formula Node frente a `Mean.vi`.

---

## 7. Dónde quedamos (2026-11-18)

- Fase 0: hecha salvo la simulación en lazo cerrado con el modelo Simulink. La v18 está probada
  en la prensa (§5).
- Fase 1: los tres textos están escritos y verificados, con las dos propuestas de §8 aplicadas.
- Fase 2: **v17 cableada el 2026-11-18** (`FluidtekPrensaCONidentLEDI_v17.vi`) y revisada tres
  veces sin ejecutarla (textos con `pruebas/comprueba_vi.ps1`, diagrama leído por ActiveX sobre
  una copia; última versión, la de las 16:06). Textos iguales a los archivos, flecha sin romper,
  cableado conforme a la guía y sin correcciones pendientes (guía §6).
- El mismo día el laboratorio retiró de la carpeta la v16, `PID.c`, `ParamPID.c` y `TIME.vi`
  (siguen en el historial de git, commit 430d23c). `pruebas/arnes_v17.js` lee `PID.c` y
  `ParamPID.c`: hay que recuperarlos para volver a ejecutarlo.
- **Puesta en marcha y capturas hechas el 2026-11-18** (`results/v17/`: capturas de pantalla
  `a`–`e` de los pasos de la guía §8 y `prueba P1`–`P4`, control y QuantumX):

  | | Maniobra | v17 | Referencia v16 (§5) |
  |---|---|---|---|
  | P1 | 50 → 61,5 mm a 30 mm/min, 3 s, descarga y retorno | 30,03 mm/min (reloj del QuantumX); error máx 0,042 mm en el arranque, después rms 0,0022 mm; primer paso `u` = −0,248 V | 30,03; 0,032; 0,0019; primer paso 0,000 V |
  | P2 | 50 → 52,3 mm a 1,5 mm/min | 1,501 mm/min; error máx 0,0036 mm, rms 0,0008 mm | 1,500; 0,0074; 0,0008 |
  | P3 | 10 mm/min y PARO a los 35,7 s | estado 5, causa 4, `u` = −0,500 V durante 18,8 s; el vástago sube a 4,9 mm/min (null del día ≈ −0,24 V); al reanudar, `u` = +0,31 V durante ~0,1 s y +0,019 mm | −0,500 V durante 25,8 s; 2,9 mm/min; +0,03 V y +0,011 mm |
  | P4 | fuerza 0,5 → 20 kN a 10 kN/min contra la viga, 30 s, descarga y retorno | 9,99 kN/min; error rms 0,048 kN (rampa) y 0,019 kN (mantenimiento); pico 20,07 kN; descarga 38,9 kN/min; rigidez 13,5–13,9 kN/mm | 9,91; 0,088; 0,024; 20,06; 38,6; 13,2–13,6 |

  - **Registro:** una fila cada 20 ms exactos, solo con ensayo en curso, sin ningún hueco (la
    referencia tenía de 1 a 34 pasos de más de 30 ms por captura). La columna `dt` es ahora la
    nominal; el tiempo real se comprueba con el QuantumX. El panel marca 20–22 ms.
  - **Pasos a–e:** bomba apagada con «BOMBA DETENIDA» sin falla; aproximación a 50 mm/min sin
    tirón; PARO del panel con la bomba en marcha: bomba apagada y vástago subiendo.
  - **Por confirmar:** la seta física (en la captura `b` está pulsado el PARO del panel), que la
    VI termina sola con Stop y `ao0` queda en −0,5 V, y el indicador `Estado de filtro`,
    encendido en todas las capturas.
  - **Para la fase 5:** (1) tras un PARO a media rampa el integrador congelado guarda el comando
    de la rampa, no el null: al reanudar hay un salto proporcional a la velocidad; (2) en
    rampas rápidas de extensión el arranque desde el null tarda más que desde 0 V (0,042 frente
    a 0,032 mm a 30 mm/min); (3) `Fp` queda 0,8–1,4 kN por debajo de la celda: los ceros de
    presión derivaron (bomba apagada: −0,17 / +0,46 bar).
- `docs/vi_v16_2026-11-12/` (sin versionar): diagrama completo de la v16, panel, los 16 marcos
  ocultos, mosaicos legibles y todos los textos. Sirve de guía para recablear.
- Lectura del lazo digital de la v16: `ok` = DI0 y no Stop; reset = no `ok`, o Apagar, o PARO;
  DO0 = enclavamiento; DO2 = no `ok`; DO5 = 1. Indicadores: «Estado de motor» = la orden (no
  DI7), «UPH energizada» = no DI5, «Sobrecorriente» = DI5, «Nivel tanque» = DI1, «Estado de
  filtro» = no DI2. DI7 se lee y no se cablea a nada.

---

## 8. Propuestas aceptadas el 2026-11-13 (ya aplicadas)

1. **Arranque sin salto.** En la v18, `integ = 0` al iniciar un ensayo, al cambiar el tipo de
   control y durante el PARO hacía pasar el comando por 0 V (§5, hallazgo). En `Pid.c` el
   integrador se conserva; como `x_ref = x`, el comando arranca en el null aprendido.
2. **Bomba que no confirma.** Si el guardamotor dispara, en la v16 la orden de bomba sigue en 1 y
   al rearmarlo la bomba arrancaría sola. `Uph.c` retira la orden si DI7 no confirma la marcha en
   2 s (contador en `G[7]`) y exige pulsar Encender de nuevo.
