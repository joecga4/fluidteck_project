# Guía de cableado — fase 2 de la v17

Qué se construye: arranque y cierre seguros, el **lazo de máquina** con los tres Formula Node,
el lazo de interfaz adaptado a los arreglos `C` y `E`, y un lazo pequeño que escribe el CSV de
control. El lazo de registro del QuantumX no se toca en esta fase.

Los índices de los arreglos están en la cabecera de cada `.c` y en `../PLAN_v17.md` §2.
Los nombres de funciones van en inglés, como aparecen en la paleta.

---

## 0. Preparación

1. VI detenida y UPH apagada.
2. Abrir `FluidtekPrensaCONidentLEDI_v16.vi` → **File ▸ Save As… ▸ Copy ▸ Open additional copy**
   → `FluidtekPrensaLEDI_v17.vi`, en la misma carpeta. Cerrar la v16. Todo lo que sigue es en la v17.
3. Rodear con un **Diagram Disable Structure** el lazo digital antiguo y otro para el lazo de
   control antiguo (cada uno con sus Stop/Clear Task de después del lazo). Borrar los cables rotos
   que crucen el borde. Así nada de lo viejo se ejecuta, pero **los controles e indicadores del
   panel no se pierden**: sus terminales siguen dentro y se van arrastrando a su sitio nuevo.
4. El lazo de interfaz (HMI) y el de registro del QuantumX se dejan fuera: se modifican en su sitio.

Al terminar la guía, lo que quede dentro de las dos estructuras deshabilitadas son residuos; se
borran en el paso 7.

---

## 1. Arranque

**No es un lazo nuevo ni el lazo digital.** Es el código que ya existe a la izquierda del
diagrama y que se ejecuta una vez, antes de los lazos:

- el lazo pequeño con **DAQmx Reserve Network Device** (`cDAQ9184-1ADC24C`, hasta 30 intentos
  con espera de 2000 ms);
- los **Create Channel + Start Task** de DO (`PrensaLEDI_DO/port0/line0:7`) y de DI
  (`PrensaLEDI_DI/port0/line0:7`);
- el **Create Channel + Timing + Start Task** de AI (`PrensaLEDI_AI/ai0:3`, Differential, Sample
  Clock a **200000**, Continuous Samples, 500000);
- el **Create Channel + Start Task** de AO (`PrensaLEDI_AO/ao0`).

Todo eso se queda como está y fuera de las estructuras deshabilitadas. Lo que se deshabilita es
el lazo grande que estaba a la derecha de las tareas DO y DI (el que tiene `Encender`, `Apagar`,
`Stop` y la espera de 500 ms). Los cables de tarea y de error de DO y DI, que antes entraban en
ese lazo, ahora van al lazo de máquina (filas 2 y 8 de la tabla del paso 2).

Añadir una sola cosa, justo después del Start Task de la tarea AO:

- **DAQmx Write** (Analog DBL 1Chan 1Samp) con una constante **−0.5**.

---

## 2. Lazo de máquina

Un While Loop nuevo. Dentro, tres Formula Node; en cada uno se pega el texto completo del
archivo y se crean los terminales (clic derecho en el borde ▸ Add Input / Add Output) con el
nombre **exacto**, respetando mayúsculas:

| Nodo | Archivo | Entradas | Salidas |
|---|---|---|---|
| ENTRADAS | `Entradas.c` | `V` | `M` |
| UPH | `Uph.c` | `D`, `C`, `Gp` | `O`, `G` |
| PID | `Pid.c` | `G`, `M`, `C`, `tr`, `S` | `E`, `u`, `So` |

**Cable de error (un solo cable dentro del lazo).** Del arranque salen cuatro cables de error,
uno por tarea (cada uno sale de su Start Task; el de AO, del DAQmx Write de −0.5 añadido en el
paso 1). Se juntan **antes del lazo** y dentro se encadenan los cuatro DAQmx:

```
arranque (fuera del lazo)            lazo de máquina
error AI ─┐
error DI ─┤ Merge   ─► túnel ─► Read AI ─► Read DI ─► Write DO ─► Write AO ─► túnel ─► cierre
error DO ─┤ Errors              (fila 1)   (fila 2)   (fila 8)    (fila 9)
error AO ─┘
```

1. Fuera del lazo, un **Merge Errors** (paleta Programming ▸ Dialog & User Interface; se estira
   hasta cuatro entradas) con los cuatro cables de error del arranque.
2. Su salida entra al lazo por un túnel normal (no hace falta Shift Register) y va al `error in`
   del DAQmx Read de **AI**.
3. **El punto AI → DI:** el `error out` del DAQmx Read de AI va al `error in` del DAQmx Read de
   DI, los dos dentro del lazo. El cable de error que venía del Start Task de DI ya no llega a
   esa lectura: se quedó en el Merge Errors.
4. `error out` del Read de DI → `error in` del Write de DO; `error out` del Write de DO →
   `error in` del Write de AO.
5. El `error out` del Write de AO sale del lazo por un túnel hacia el cierre, y dentro del lazo
   se ramifica al Unbundle By Name (`status`) de la fila 12.

Los cuatro cables de **tarea** (morados) no se encadenan: cada uno entra al lazo por su túnel y
va solo a su propio Read o Write. Encadenar el error sirve para dos cosas: fija el orden (las
entradas digitales se leen al terminar la ventana de 20 ms de AI) y, si un DAQmx falla, los
siguientes no se ejecutan y el lazo se detiene en ese mismo paso.

Cableado de datos:

| # | Origen | Destino |
|---|---|---|
| 1 | Tarea AI → **DAQmx Read**, instancia *Analog ▸ Multiple Channels ▸ Multiple Samples ▸ 2D DBL*, `number of samples per channel` = **4000** | `data` → `V` de ENTRADAS |
| 2 | Tarea DI → **DAQmx Read** *Digital 1D Bool NChan 1Samp 1Line* (la misma instancia de antes) → **Boolean To (0,1)** → **To Double Precision Float** | → `D` de UPH |
| 3 | Lector del canal `C` (se crea en el paso 4) | → `C` de UPH y → `C` de PID |
| 4 | `G` de UPH | → `G` de PID, y → **Feedback Node** → `Gp` de UPH |
| 5 | `M` de ENTRADAS | → `M` de PID |
| 6 | `So` de PID → **Feedback Node** | → `S` de PID |
| 7 | **High Resolution Relative Seconds** | → `tr` de PID |
| 8 | `O` de UPH → **Not Equal To 0?** | → **DAQmx Write** *Digital 1D Bool NChan 1Samp 1Line* sobre la tarea DO |
| 9 | `u` de PID | → **DAQmx Write** *Analog DBL 1Chan 1Samp* sobre la tarea AO |
| 10 | `E` de PID | → escritor de canal **Tag** (hacia la interfaz) |
| 11 | `E` de PID → **Array Subset** (index 0, length 15), dentro del marco True de un Case (ver «Registro solo durante el ensayo») | → escritor de canal **Stream** (hacia el registro), en el mismo marco True |
# Pendiente por dudas
| 12 | **Index Array** de `G` con índice 6, **Greater? 0.5**, **Or** con el `status` del cable de error | → condición de parada del lazo (Stop if True) |

Detalles:

- **Feedback Node** (filas 4 y 6): cablear el inicializador con una **constante de arreglo 1D DBL
  vacía** y sacarlo del lazo (clic derecho ▸ Move Initializer One Loop Out). Los textos ya tratan
  el arreglo vacío como «primera iteración».
- **Registro solo durante el ensayo** (fila 11): `E[1]` es el estado del ensayo (0 = reposo,
  1 a 4 = ensayo en curso, 5 = falla). Para sacarlo, un **Index Array** (paleta Array) con el
  cable `E` en la entrada de arriba y una constante **1** en `index`; su salida va a un
  **Greater?** con la constante **0.5**, y el booleano resultante al selector (`?`) de un **Case
  Structure**. En el marco **True** van el Array Subset y el escritor Stream; el marco **False**
  queda vacío. El cable `E` entra al Case por un túnel. Lo que tiene que estar dentro del Case
  es el escritor Stream: es el que no debe ejecutarse en reposo.
- **Canales** (filas 3, 10 y 11): clic derecho en el terminal ▸ Create ▸ Channel Writer… y elegir
  Tag o Stream; en el otro extremo, Create ▸ Channel Reader. En todos los casos el endpoint es
  el sencillo, **Write** o **Read**: los *Scheduled* son para leer o escribir a una hora
  programada y no se usan. En los Write no se cablea `size` ni `timeout`.
- En este lazo no debe haber **ningún** terminal del panel, variable local o global, Property Node
  ni escritura de archivos.
- No hace falta Wait: el periodo lo marca la lectura de 4000 muestras (20 ms).

---

## 3. Cierre

Después del lazo de máquina, en este orden:

1. **DAQmx Write** (Analog DBL 1Chan 1Samp) con **−0.5** sobre la tarea AO.
2. **DAQmx Write** (Digital 1D Bool NChan 1Samp 1Line) sobre la tarea DO con una constante de
   8 booleanos: todos F salvo el índice **5** en T (bomba apagada, transductores alimentados).
3. Stop Task y Clear Task de las cuatro tareas, y el Simple Error Handler al final.

**Lo único que se deja sin cablear es el terminal `error in` (abajo a la izquierda) de las dos
escrituras 1 y 2.** Un DAQmx Write al que le llega un error por `error in` no escribe nada; si
el lazo terminó por un error del cDAQ y ese error llegara a estas escrituras, la válvula no
recibiría −0.5 V ni se bajaría la orden de bomba. Con `error in` vacío se ejecutan siempre.
Su `error out` (abajo a la derecha) **sí se cablea**, hacia el Stop Task de su misma tarea.

Cable de error en el cierre: cuatro cadenas en paralelo, una por tarea, como en la v16. En cada
cadena el cable va de `error out` a `error in` del bloque siguiente; la tabla dice qué se
conecta al `error in` del **primer** bloque de la cadena:

| Tarea | Cadena | `error in` del primer bloque |
|---|---|---|
| AO | Write −0.5 → Stop Task → Clear Task | vacío (es la escritura 1) |
| DO | Write del patrón → Stop Task → Clear Task | vacío (es la escritura 2) |
| AI | Stop Task → Clear Task | el cable de error que sale del lazo de máquina |
| DI | Stop Task → Clear Task | vacío |

```
tarea AO ─► Write −0.5 ─► Stop ─► Clear ─┐
tarea DO ─► Write patrón ─► Stop ─► Clear ─┤ Merge   ─► Simple Error
tarea AI ─► Stop ─► Clear ────────────────┤ Errors      Handler
tarea DI ─► Stop ─► Clear ────────────────┘
            ▲
            error que sale del lazo (solo a la cadena de AI)
```

Los `error out` de los cuatro Clear Task van a un **Merge Errors** y de ahí al Simple Error
Handler. Así el error que detuvo el lazo se muestra al final (viaja por la cadena de AI) y no
impide las dos escrituras seguras. Clear Task se ejecuta aunque le llegue un error.

---

## 4. Lazo de interfaz (el HMI actual, modificado)

Se conserva toda la lógica de normas y de habilitar/ocultar controles. Cambian solo la salida
hacia el control, la entrada desde el control y la parada.

### 4.1 Comandos: del panel a `C`

Quitar el Bundle del clúster «embolo» y su escritor de canal. En su lugar, un **Build Array** con
*Concatenate Inputs* activado y estas entradas, de arriba abajo:

| Entrada del Build Array | Índices de `C` |
|---|---|
| `Tipo control` | 0 |
| Un **Build Array** de 6 booleanos, en este orden: `Iniciar ensayo`, `PARO DE EMERGENCIA`, `Encender`, `Apagar`, `Stop`, `Sin proteccion de carga` → **Boolean To (0,1)** | 1 a 6 |
| `Posicion deseada (mm)` | 7 |
| `Fuerza deseada (kN)` | 8 |
| `Limite posicion (mm)` | 9 |
| `Limite fuerza (kN)` | 10 |
| `Rampa (mm/min)` | 11 |
| `Rampa (kN/min)` | 12 |
| `Tiempo carga (s)` | 13 |
| `Vel. aproximacion (mm/min)` | 14 |
| `Fmax fuera de ensayo (kN)` | 15 |
| `Codigo acceso` | 16 |
| `Kx lazo posicion (V/mm)` | 17 |
| `Ti lazo posicion (s)` | 18 |
| `Kf lazo fuerza (1/s)` | 19 |
| El terminal de iteración `i` del lazo | 20 |

La salida (arreglo DBL de 21 elementos) → escritor de canal **Tag** → es el canal `C` de la fila 3.

Los terminales de `PARO DE EMERGENCIA`, `Encender`, `Apagar`, `Stop`, `Sin proteccion de carga`,
`Codigo acceso`, `Kx`, `Ti`, `Kf`, `Vel. aproximacion` y `Fmax fuera de ensayo` están hoy en los
lazos deshabilitados: arrastrarlos aquí. Si quedaba alguna variable local de `PARO DE EMERGENCIA`,
borrarla.

### 4.2 Estado: de `E` al panel

Quitar el lector del canal de 6 valores y el Unbundle. En su lugar: lector del canal **Tag** de
`E` → **Index Array** estirado a 28 salidas (sin cablear los índices: salen 0, 1, 2…).

| `E` | Va a | Conversión |
|---|---|---|
| 0 | `Tiempo (s)` | |
| 1 | `Estado del ensayo`; y a la lógica que hoy lee su variable local | |
| 1 | global `Ensayando` y disparo de `InfoEnsayo` (lo que hacía el lazo de control) | Greater? 0.5 |
| 2 | entrada de arriba del Merge Signals del gráfico `control signals` (la consigna; ver «Gráficos») | |
| 3 | `Fuerza actual (KN)`; fuerza del gráfico F-D; medida del gráfico en modo fuerza | |
| 4 | `Posicion actual (mm)`; barra del cilindro; desplazamiento del gráfico F-D; medida en modo desplazamiento | |
| 5 | `Consigna posicion interna (mm)` | |
| 7 | `Rigidez estimada (kN/mm)` | |
| 9 | `Falla` | Not Equal To 0? |
| 10 | `Causa de la falla` | |
| 11 | `Proteccion de fuerza activa` | Not Equal To 0? |
| 12 | `Presión A (bar)` | |
| 13 | `Presión B (bar)` | |
| 16 | `Estado de motor` (ahora es la marcha real de la bomba, DI7) | Not Equal To 0? |
| 18 | `Nivel tanque` | Not Equal To 0? |
| 19 | `Estado de filtro` (como hoy: encendido = filtro saturado) | Equal To 0? |
| 20 | `Sobrecorriente` | Not Equal To 0? |
| 20 | `UPH energizada` (como hoy: guardamotor sin disparar) | Equal To 0? |
| 21 | `Carga maxima (kN)` | |
| 22 | `Progreso mantenimiento` | |
| 23 | `Tiempo restante carga (s)` | |
| 24 | `Parametros avanzados` | |
| 26 | `time/iteration (ms)` | × 1000 |

Los índices 6, 8, 14, 15, 17, 25 y 27 no se usan todavía en el panel.

**Un índice con varios destinos** (1, 3, 4 y 20): el Index Array tiene una sola salida por índice;
el cable se ramifica. El 20 es el guardamotor (DI5, 1 = disparado): una rama pasa por
**Not Equal To 0?** hacia `Sobrecorriente` y la otra por **Equal To 0?** hacia `UPH energizada`.
Los dos indicadores son siempre opuestos, como en la v16.

**Gráficos: no se rehace nada, solo cambia de dónde vienen tres cables.** En la v16 salían del
Unbundle de 6 valores; ahora salen del Index Array de `E`. Todo lo que cuelga de ellos se
conserva tal cual:

| Cable de la v16 (salida del Unbundle, de arriba abajo) | Ahora | Lo que cuelga de él y no se toca |
|---|---|---|
| 2.ª: posición | `E[4]` | `Posicion actual (mm)`, barra del cilindro, Insert Into Array de arriba (historia del gráfico `fuerza desplazamiento`), túnel de arriba del Case de `Tipo control` |
| 3.ª: fuerza | `E[3]` | `Fuerza actual (KN)`, Insert Into Array de abajo, túnel de abajo del Case de `Tipo control` |
| 6.ª: consigna | `E[2]` | entrada de **arriba** del Merge Signals de `control signals` |

El gráfico `control signals` sigue recibiendo un **Merge Signals** de dos señales: arriba la
consigna (`E[2]`) y abajo la medida, que es la salida del Case de `Tipo control` (marco 0:
posición; marco 1 «PID fuerza»: fuerza). Ese Case y el Merge Signals quedan como están. Las
otras tres salidas del Unbundle (tiempo y presiones) se sustituyen según el indicador al que
llegan: `Tiempo (s)` ← `E[0]`, `Presión A (bar)` ← `E[12]`, `Presión B (bar)` ← `E[13]`.

### 4.3 Parada

- `Stop` → condición de parada del lazo de interfaz, y → global `Salir` (la usa el lazo de registro).
- No hace falta más: en la iteración en que `Stop` vale T, `C[5]` = 1 sale por el canal antes de
  que el lazo termine; el lazo de máquina apaga la bomba, termina y hace el cierre.

### 4.4 Panel

- En la lista `Causa de la falla`, cambiar el texto 6 («SIN LECTURA DE FUERZA (QuantumX)») por
  **BOMBA DETENIDA**.

---

## 5. Registro de control

Un While Loop pequeño y aparte.

**No es el canal que va a la interfaz.** De `E` salen dos canales distintos en el lazo de máquina:

| Fila | Canal | Lleva | Llega a |
|---|---|---|---|
| 10 | **Tag** | los 28 valores de `E`, solo el más reciente | lazo de interfaz → Index Array (paso 4.2) |
| 11 | **Stream** | las 15 primeras columnas, una fila por cada paso de ensayo, sin perder ninguna | este lazo de registro → archivo |

El Tag sirve para mostrar (la interfaz corre cada 100 ms y solo necesita el último valor); el
Stream es una cola y entrega todas las filas de 20 ms, que es lo que necesita el archivo. El
Stream no pasa por el lazo de interfaz ni por ningún Index Array.

- Lector del canal **Stream** de la fila 11 (el que sale del Case, después del Array Subset):
  endpoint **Read** a secas (no *Read Scheduled*, ni *Read Multiple*), con una constante **100**
  en su entrada `timeout in ms (-1)`. Sin ese 100 el lector espera sin límite y el lazo no
  podría terminar cuando no hay ensayo.
- La salida `element valid?` del lector va al selector de un Case. Marco True (llegó un
  elemento): **Write Delimited Spreadsheet** con la ruta de la global `ArchivoControl`,
  `append to file?` = T y `format` = `%.5f` (igual que hacía el lazo de control).
- Parada: global `Salir`.

El CSV conserva las 15 columnas de siempre, así se compara con `results/referencia_v18/`.

---

## 6. Antes de ejecutar

1. Flecha de ejecución sin romper.
2. Guardar y **cerrar LabVIEW**. Avisarme: compruebo que los tres textos pegados coinciden con
   los archivos y leo el diagrama para revisar el cableado contra esta guía.

### Revisión del 2026-11-18 (diagrama leído con LabVIEW cerrado)

Textos pegados iguales a los archivos, flecha sin romper, y arranque, lazo de máquina, cierre,
`C`, `E`, gráficos y registro conformes a esta guía. Correcciones antes de ejecutar con el equipo:

1. **Cierre, constante de 8 booleanos:** la T está en el índice 4; debe estar en el **5** (sexto
   elemento). Como está, al cerrar activaría DO4 (K5, sin identificar) y cortaría DO5 (transductores).
2. **Global `Salir`:** en el lazo de interfaz está como lectura y nadie la pone en T. Cambiarla a
   escritura (clic derecho ▸ Change To Write), cablearle `Stop`, y llevar `Stop` también a la
   condición de parada del lazo (paso 4.3).
3. **Globales `Ensayando` e `InfoEnsayo`** (fila 1 de la tabla 4.2): `E[1]` → **Greater?** 0.5 →
   global `Ensayando` (escritura). Para `InfoEnsayo`, copiar de la v16 el Property Node
   `RingText.Text` y cablearlo a la global `InfoEnsayo` (escritura); puede quedar suelto en el
   lazo de interfaz, sin el Case ni el detector de flanco.
4. Menor: `time/iteration (ms)` necesita un **Multiply** por 1000 (`E[26]` llega en segundos).

### Segunda revisión del 2026-11-18 (VI guardada a las 12:21)

Hechas la 1 (T en el índice 5), la 3 (`Ensayando`, y `InfoEnsayo` con el detector de flanco y el
Case, igual que en la v16) y la 4 (nodo `1000*x`). De la 2 está hecho `Stop` → `Salir`; falta
una cosa:

- **Condición de parada del lazo de interfaz:** sigue cableada a una lectura de `Salir`. Borrar
  esa lectura (arriba a la izquierda del lazo, junto al terminal rojo) y cablear `Stop`
  directamente al terminal de parada. Motivo: `Stop` se escribe en `Salir` en cada vuelta; si el
  botón es de pulso, a la vuelta siguiente vale F otra vez y puede dejar `Salir` en F antes de
  que los lazos de registro y del QuantumX la hayan leído. Con `Stop` directo, el lazo termina
  en la misma vuelta en que escribe T y nadie la vuelve a pisar (así lo hacía el lazo digital de
  la v16).

**Tercera lectura (VI guardada a las 16:06): hecho.** `Stop` va a `C`, a `Salir` y directo al
terminal de parada; la lectura de `Salir` del lazo de interfaz ya no está. No quedan
correcciones: lo siguiente es la puesta en marcha (paso 8).

## 7. Limpieza

Cuando lo anterior esté revisado: borrar las dos estructuras deshabilitadas con lo que quede
dentro, y de `GlobalesPrensa.vi` las globales `F_QX` y `tQX` si ya nada las usa
(clic derecho ▸ Find ▸ Global References).

---

## 8. Puesta en marcha (después de la revisión)

Alguien junto a la seta. Sin probeta.

| Paso | Qué se hace | Qué se espera |
|---|---|---|
| a | Bomba apagada: ejecutar la v17 | lecturas iguales a las de la v16; `time/iteration` ≈ 20 ms; causa «BOMBA DETENIDA» sin falla; con un voltímetro o en MAX, `ao0` = −0.5 V |
| b | Pulsar la seta y soltarla | «PARO DE EMERGENCIA» mientras está pulsada |
| c | Poner la posición deseada a unos 5 mm de la real y pulsar Encender | el vástago va hacia la consigna a la velocidad de aproximación, sin tirón |
| d | PARO del panel con la bomba en marcha | la bomba se apaga, `u` = −0.5 V, el vástago sube despacio |
| e | Encender y, con la bomba en marcha, Stop | la bomba se apaga y la VI termina; `ao0` queda en −0.5 V |
| f | Repetir las capturas P1 a P4 | se comparan con `results/referencia_v18/` |
