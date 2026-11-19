// Arnes de pruebas de PID.c (texto del Formula Node del controlador) con el motor JScript de
// Windows: no necesita instalar nada. La sintaxis del Formula Node es casi la de JScript; solo se
// traducen las declaraciones float64.
//
//   cscript //nologo arnes_pid.js igual    <a.c> <b.c> [N]   N pasos sueltos con entradas y estado
//                                                            aleatorios, con y sin corte por presiones:
//                                                            las dos versiones deben dar lo mismo
//   cscript //nologo arnes_pid.js trayecto <a.c> <b.c>       escenarios en lazo cerrado con una planta
//                                                            sencilla (ley comando-velocidad medida y
//                                                            apoyo de 14 kN/mm); compara a.c con b.c
//
// Para comparar con una version anterior:  git show <commit>:labview_control_software/PID.c > ref.c
// Un cambio de comportamiento deliberado se prueba escribiendo, a partir de la salida de la version
// vieja, lo que DEBE dar la nueva (asi se verifico la v18; ver PLAN_v17.md), y con mutantes.
var fso = new ActiveXObject("Scripting.FileSystemObject");
function lee(ruta) { var f = fso.OpenTextFile(ruta, 1); var s = f.ReadAll(); f.Close(); return s; }

// ---- funciones del Formula Node
function min(a, b) { return Math.min(a, b); }
function max(a, b) { return Math.max(a, b); }
function abs(a) { return Math.abs(a); }
function sign(a) { return a > 0 ? 1 : (a < 0 ? -1 : 0); }
function sizeOfDim(a, d) { return a.length; }
function ceros(n) { var a = []; for (var i = 0; i < n; i++) a[i] = 0; return a; }

var ENT = ['x','F','modo','t','tr','pa','pb','vjog','Flib','sinprot','ini','inip','spm','lim','rate','tc','xlim','paro','stp','f0p','tsp','P','S'];
var SAL = ['st','f0','ts','inio','sp','prot','prog','trest','falla','causa','Fpko','xspo','kho','u'];

function compila(txt, presOn) {
    txt = txt.replace(/\r/g, '');
    if (presOn) {
        if (!/prot_pres_on\s*=\s*0;/.test(txt)) throw new Error('no encuentro prot_pres_on = 0');
        txt = txt.replace(/prot_pres_on\s*=\s*0;/, 'prot_pres_on = 1;');
    }
    txt = txt.replace(/float64\s+(\w+)\[(\d+)\];/g, function (m, n, k) { return 'var ' + n + ' = ceros(' + k + ');'; });
    txt = txt.replace(/float64\s+/g, 'var ');
    var pre = 'var ' + SAL.join(',') + ';\n';
    var post = '\nreturn {' ; var i;
    for (i = 0; i < SAL.length; i++) post += SAL[i] + ':' + SAL[i] + ',';
    post += 'So:So,Lg:Lg};';
    var args = ENT.slice(0); args.push(pre + txt + post);
    return Function.apply(null, args);
}
function llama(f, e) { return f(e.x,e.F,e.modo,e.t,e.tr,e.pa,e.pb,e.vjog,e.Flib,e.sinprot,e.ini,e.inip,e.spm,e.lim,e.rate,e.tc,e.xlim,e.paro,e.stp,e.f0p,e.tsp,e.P,e.S); }

// ---- aleatorio reproducible (Park-Miller)
var semilla = 12345;
function rnd() { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; }
function U(a, b) { return a + (b - a) * rnd(); }
function elige(a) { return a[Math.floor(rnd() * a.length)]; }

function caso() {
    var e = {};
    e.modo = rnd() < 0.5 ? 0 : 1;
    e.x = U(0, 150);
    var r = rnd();
    if (r < 0.60) e.F = U(-2, 60); else if (r < 0.72) e.F = U(0, 6); else if (r < 0.88) e.F = U(120, 200);
    else if (r < 0.93) e.F = U(-200, -120); else e.F = U(155, 165);
    if (rnd() < 0.004) e.x = NaN;
    if (rnd() < 0.004) e.F = NaN;
    e.t = U(0, 2000); e.tr = U(10, 1e5);
    e.pa = rnd() < 0.85 ? U(0, 80) : U(80, 120); e.pb = U(0, 150);
    e.vjog = elige([0, -5, 25, 50, 80, U(1, 60)]);
    e.Flib = elige([0, 1, 4, -3, 100, U(0.1, 60)]);
    e.sinprot = rnd() < 0.2 ? 1 : 0;
    e.ini = rnd() < 0.6 ? 10 : 0;
    e.inip = (e.ini > 5) ? (rnd() < 0.9 ? 10 : 0) : (rnd() < 0.2 ? 10 : 0);
    e.spm = e.modo > 0.5 ? U(-10, 200) : U(0, 150);
    e.lim = e.modo > 0.5 ? U(0, 200) : U(0, 150);
    e.rate = elige([U(0.05, 100), -U(0.05, 100), 0.1, 1.5]);
    e.tc = rnd() < 0.2 ? 0 : U(0, 60);
    e.xlim = U(20, 150);
    e.paro = rnd() < 0.06 ? 1 : 0;
    e.stp = Math.floor(rnd() * 6);
    e.f0p = e.modo > 0.5 ? U(0, 60) : U(0, 150);
    e.tsp = e.t - U(0, 100);
    r = rnd();
    if (r < 0.01) e.P = [30, 1.5]; else if (r < 0.015) e.P = []; else if (r < 0.5) e.P = [30, 1.5, 0.5];
    else e.P = [U(1, 100), U(0.1, 60), U(0.05, 5)];
    var med = e.modo > 0.5 ? e.F : e.x;
    r = rnd();
    if (r < 0.08) e.S = ceros(12);
    else if (r < 0.10) e.S = ceros(5);
    else {
        var dt = rnd() < 0.9 ? U(0.015, 0.03) : elige([0, -1, 2, 0.5]);
        e.S = [e.x + U(-3, 3), Math.exp(U(Math.log(0.02), Math.log(50))), rnd() < 0.3 ? 0 : U(0, 200), U(-0.5, 0.5),
               med + U(-2, 2), e.tr - dt, e.F + U(-3, 3), e.x + U(-6, 6), U(0, 150), U(-10, 10),
               rnd() < 0.95 ? e.modo : 1 - e.modo, Math.floor(rnd() * 8)];
    }
    return e;
}

function igual(a, b) {
    if (a !== a && b !== b) return true;                  // NaN = NaN
    if (a === b) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
function copia(o) { var c = {}, i; for (i = 0; i < SAL.length; i++) c[SAL[i]] = o[SAL[i]]; c.So = o.So.slice(0); c.Lg = o.Lg.slice(0); return c; }
function difs(a, b) {
    var d = [], i;
    for (i = 0; i < SAL.length; i++) if (!igual(Number(a[SAL[i]]), Number(b[SAL[i]]))) d.push(SAL[i] + ': ' + a[SAL[i]] + ' / ' + b[SAL[i]]);
    for (i = 0; i < 12; i++) if (!igual(Number(a.So[i]), Number(b.So[i]))) d.push('So[' + i + ']: ' + a.So[i] + ' / ' + b.So[i]);
    for (i = 0; i < 15; i++) if (!igual(Number(a.Lg[i]), Number(b.Lg[i]))) d.push('Lg[' + i + ']: ' + a.Lg[i] + ' / ' + b.Lg[i]);
    return d;
}

function pruebaIgual(fa, fb, N, verboso) {
    var fallos = 0, k;
    for (k = 0; k < N; k++) {
        var e = caso();
        var d = difs(llama(fa, e), llama(fb, e));
        if (d.length) {
            fallos++;
            if (verboso && fallos <= 5) WScript.Echo('  DIFERENCIA paso ' + k + ' (paro=' + e.paro + ' F=' + e.F + ' modo=' + e.modo + ' stp=' + e.stp + ' ini=' + e.ini + '): ' + d.join('; '));
        }
    }
    return fallos;
}

// ---- planta sencilla para los trayectos (ley comando-velocidad medida + apoyo elastico)
function vley(u) { return u >= 0 ? 0.4459 * u + 0.1139 : 0.3779 * u + 0.1397; }
function trayecto(f, esc) {
    var Ts = 0.02, x = esc.x0, kc = 14, xc = 60, uap = -0.3697, k;
    var est = { stp: 0, f0p: 0, tsp: 0, inip: 0, S: ceros(12) };
    var reg = { t: [], x: [], F: [], u: [], st: [], sp: [], falla: [], causa: [] };
    var nT = Math.round(esc.dur / Ts);
    for (k = 0; k < nT; k++) {
        var t = k * Ts;
        var F = kc * Math.max(0, x - xc);
        var c = esc.fn(t, F, x);
        var e = { x: c.nan ? NaN : x, F: F, modo: c.modo, t: t, tr: 1000 + t, pa: 35, pb: 47, vjog: 50, Flib: c.Flib,
                  sinprot: c.sinprot, ini: c.ini, inip: est.inip, spm: c.spm, lim: c.lim, rate: c.rate, tc: c.tc, xlim: 145,
                  paro: c.paro, stp: est.stp, f0p: est.f0p, tsp: est.tsp, P: [30, 1.5, 0.5], S: est.S };
        var o = llama(f, e);
        est = { stp: o.st, f0p: o.f0, tsp: o.ts, inip: o.inio, S: o.So };
        reg.t.push(t); reg.x.push(x); reg.F.push(F); reg.u.push(o.u); reg.st.push(o.st); reg.sp.push(o.sp); reg.falla.push(o.falla); reg.causa.push(o.causa);
        var v = vley(uap);                                  // el comando actua un paso despues
        if (v > 0) v = v * Math.max(0, 1 - F / 200);        // la fuerza frena el avance (suministro limitado)
        x = Math.min(150, Math.max(0, x + v * Ts));
        uap = o.u;
    }
    return reg;
}
function base(o) { var b = { modo: 0, ini: 0, spm: 60, lim: 0, rate: 1, tc: 0, paro: 0, nan: 0, sinprot: 0, Flib: 4 }; for (var k in o) b[k] = o[k]; return b; }
var ESC = [
    { nombre: 'posicion 50 -> 58 -> 52 mm (fuera de ensayo)', x0: 50, dur: 40,
      fn: function (t) { return base({ spm: t < 1 ? 50 : (t < 20 ? 58 : 52) }); } },
    { nombre: 'ensayo de posicion 55 -> 61.5 mm a 30 mm/min, 5 s, descarga', x0: 55, dur: 60,
      fn: function (t) { return base({ spm: 55, ini: t > 2 ? 10 : 0, lim: 61.5, rate: 30, tc: 5 }); } },
    { nombre: 'ensayo de fuerza a 40 kN (120 kN/min, 5 s, descarga, retorno)', x0: 59.8, dur: 110,
      fn: function (t) { return base({ modo: 1, spm: 1, ini: t > 15 ? 10 : 0, lim: 40, rate: 120, tc: 5 }); } },
    { nombre: 'ensayo de fuerza con PARO de 10 s a media rampa', x0: 59.8, dur: 70, paro: [30, 40],
      fn: function (t) { return base({ modo: 1, spm: 1, ini: t > 15 ? 10 : 0, lim: 40, rate: 60, tc: 5, paro: (t >= 30 && t < 40) ? 1 : 0 }); } },
    { nombre: 'lectura de posicion invalida (NaN) 5 s manteniendo 20 kN', x0: 59.8, dur: 70, nan: [40, 45],
      fn: function (t) { return base({ modo: 1, spm: 1, ini: t > 15 ? 10 : 0, lim: 20, rate: 120, tc: 30, nan: (t >= 40 && t < 45) ? 1 : 0 }); } },
    { nombre: 'limite del sistema: fuerza pedida 200 kN sin proteccion', x0: 70.5, dur: 120,
      fn: function (t) { return base({ modo: 1, spm: 200, sinprot: 1 }); } }
];
function maxabs(a, b) { var m = 0, i; for (i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d > m || d !== d) m = d; } return m; }
function enT(r, t) { var i = Math.round(t / 0.02); if (i >= r.t.length) i = r.t.length - 1; return i; }
function fmt(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toString(); }

// ---- principal
var A = WScript.Arguments;
if (A.length < 3) { WScript.Echo('uso: cscript //nologo arnes_pid.js igual|trayecto <a.c> <b.c> [N]'); WScript.Quit(2); }
var modo = A(0), ta = lee(A(1)), tb = lee(A(2)), N = A.length > 3 ? parseInt(A(3), 10) : 100000, total = 0;
if (modo == 'igual') {
    for (var pres = 0; pres < 2; pres++) {
        semilla = 12345 + pres;
        var f = pruebaIgual(compila(ta, pres), compila(tb, pres), N, true);
        total += f;
        WScript.Echo('corte por presiones ' + (pres ? 'ACTIVO' : 'desactivado') + ': ' + N + ' pasos, ' + f + ' con diferencias');
    }
    WScript.Quit(total ? 1 : 0);
} else if (modo == 'trayecto') {
    var fa = compila(ta, 0), fb = compila(tb, 0);
    for (var i = 0; i < ESC.length; i++) {
        var a = trayecto(fa, ESC[i]), b = trayecto(fb, ESC[i]), n = a.t.length - 1;
        var s = ESC[i].nombre + '\n    max|dif|: u ' + maxabs(a.u, b.u).toExponential(1) + ' V, x ' + maxabs(a.x, b.x).toExponential(1) + ' mm, F ' + maxabs(a.F, b.F).toExponential(1) + ' kN' +
            '\n    final (a / b): x ' + fmt(a.x[n], 3) + ' / ' + fmt(b.x[n], 3) + ' mm, F ' + fmt(a.F[n], 2) + ' / ' + fmt(b.F[n], 2) + ' kN, st ' + a.st[n] + ' / ' + b.st[n] + ', Fmax ' + fmt(Math.max.apply(null, a.F), 2) + ' / ' + fmt(Math.max.apply(null, b.F), 2);
        var w = ESC[i].paro || ESC[i].nan;
        if (w) {
            var i0 = enT(a, w[0]), i1 = enT(a, w[1] - 0.02);
            s += '\n    durante el evento (' + w[0] + '-' + w[1] + ' s)  a: u ' + fmt(a.u[i1], 3) + ' V, F ' + fmt(a.F[i0], 2) + ' -> ' + fmt(a.F[i1], 2) + ' kN, x ' + fmt(a.x[i0], 3) + ' -> ' + fmt(a.x[i1], 3) + ' mm' +
                 '\n                                 b: u ' + fmt(b.u[i1], 3) + ' V, F ' + fmt(b.F[i0], 2) + ' -> ' + fmt(b.F[i1], 2) + ' kN, x ' + fmt(b.x[i0], 3) + ' -> ' + fmt(b.x[i1], 3) + ' mm';
        }
        WScript.Echo(s);
    }
} else { WScript.Echo('modo desconocido: ' + modo); WScript.Quit(2); }
