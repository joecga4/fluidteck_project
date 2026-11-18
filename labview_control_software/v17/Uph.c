/* ===========================================================================
   NODO UPH - prensa Fluidtek, VI v17
   Segundo Formula Node del lazo de maquina: unidad hidraulica y seguridad.
   Lee las entradas digitales, decide la orden de la bomba y arma las salidas
   digitales.
   ===========================================================================

   TERMINALES
     Entradas  D   las 8 entradas digitales como 0/1 (PrensaLEDI_DI/port0/line0:7)
               C   comandos del panel (los mismos del nodo PID)
               Gp  la salida G del paso anterior (vacia en la primera iteracion)
     Salidas   O   las 8 salidas digitales como 0/1 (PrensaLEDI_DO/port0/line0:7)
               G   UPH y seguridad (8), para el nodo PID y para Gp

   D[]  0 seta de emergencia (1 = segura)   1 nivel de aceite (1 = OK)
        2 filtro en linea (1 = limpio)      5 guardamotor GM1 (1 = disparado o apagado)
        7 confirmacion de marcha, KM1 (1 = bomba en marcha)
   C[]  2 PARO del panel   3 encender (pulso)   4 apagar (pulso)   5 salir (Stop)
   O[]  0 orden de bomba (K1 -> KM1)
        2 "salida contactor2" (K3): 1 con la seta pulsada o al salir, como en la v16
        5 alimentacion de los transductores de presion (K6): siempre 1
   G[]  0 seta (1 = segura)   1 bomba en marcha (DI7)   2 orden de bomba
        3 nivel   4 filtro   5 guardamotor   6 salir
        7 pasos seguidos con orden de bomba y sin confirmacion de marcha

   ORDEN DE BOMBA  Enclavamiento con PRIORIDAD AL APAGADO: seta pulsada, PARO,
   Apagar o Salir la ponen a 0 aunque llegue Encender en el mismo paso; Encender
   la pone a 1; si no hay orden, conserva la anterior. Sin entradas digitales o
   sin comandos, la bomba queda apagada.

   BOMBA QUE NO CONFIRMA  Si hay orden y DI7 no confirma la marcha durante 2 s
   (guardamotor disparado, contactor que no entra), la orden se retira: asi la
   bomba no arranca sola al rearmar el guardamotor. Hay que pulsar Encender.
   =========================================================================== */

int32 i;
float64 seta, nivel, filtro, guarda, marcha;
float64 paro, encender, apagar, salir, bomba, sin_marcha, pasos_conf;
float64 O[8], G[8];

pasos_conf = 100;   /* pasos de 20 ms sin confirmacion de marcha antes de retirar la orden (2 s) */

/* entradas digitales: sin lectura, seta pulsada y todo en falta */
seta=0; nivel=0; filtro=0; guarda=1; marcha=0;
if (sizeOfDim(D,0)>=8) {
    seta=D[0]; nivel=D[1]; filtro=D[2]; guarda=D[5]; marcha=D[7];
}

/* comandos: sin panel, como si se pidiera PARO */
paro=1; encender=0; apagar=0; salir=0;
if (sizeOfDim(C,0)>=20) {
    paro=C[2]; encender=C[3]; apagar=C[4]; salir=C[5];
}

/* orden de bomba: la anterior, salvo orden nueva; el apagado manda */
bomba = 0; sin_marcha = 0;
if (sizeOfDim(Gp,0)>=8) { bomba = Gp[2]; sin_marcha = Gp[7]; }
if (encender>0.5) bomba = 1;
if (seta<0.5 || paro>0.5 || apagar>0.5 || salir>0.5) bomba = 0;

/* bomba que no confirma: con orden y sin marcha se cuenta; pasado el plazo se retira la orden */
if (bomba>0.5 && marcha<0.5) sin_marcha = sin_marcha + 1;
else sin_marcha = 0;
if (sin_marcha>pasos_conf) { bomba = 0; sin_marcha = 0; }

/* salidas digitales */
for (i=0; i<8; i++) O[i] = 0;
O[0] = bomba;
if (seta<0.5 || salir>0.5) O[2] = 1;
O[5] = 1;

/* estado para el PID y para el paso siguiente */
G[0]=seta;  G[1]=marcha;  G[2]=bomba;  G[3]=nivel;  G[4]=filtro;  G[5]=guarda;  G[6]=salir;
G[7]=sin_marcha;
