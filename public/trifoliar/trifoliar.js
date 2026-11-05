// Trifoliar de MigraRed: doblado en computadora y navegación por paneles en el celular.
(function () {
  var hoja = document.getElementById('hoja');
  var indicador = document.getElementById('indicador');
  var botonesEstado = document.querySelectorAll('.controles [data-ir]');
  var modoEscritorio = matchMedia('(min-width: 900px) and (min-height: 560px)');

  // ---------------- Computadora: estados de doblado ----------------
  var ESTADOS = ['cerrado', 'medio', 'abierto', 'exterior'];
  var TEXTOS = {
    cerrado: 'Cerrado · Portada',
    medio: 'Abriendo · Panel 2 y solapa',
    abierto: 'Cara interna · Paneles 2, 3 y 4',
    exterior: 'Cara externa · Paneles 5, 6 y 1',
  };
  // Caras que se ven en cada estado (las demás se ocultan a lectores de pantalla).
  var VISIBLES = { cerrado: [1], medio: [2, 5], abierto: [2, 3, 4], exterior: [5, 6, 1] };

  function irA(estado) {
    hoja.dataset.estado = estado;
    botonesEstado.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.ir === estado));
    });
    if (modoEscritorio.matches) {
      indicador.textContent = TEXTOS[estado];
      hoja.querySelectorAll('.cara').forEach(function (c) {
        c.setAttribute('aria-hidden', String(VISIBLES[estado].indexOf(Number(c.dataset.num)) === -1));
      });
    }
  }

  function avanzar(paso) {
    var i = ESTADOS.indexOf(hoja.dataset.estado);
    irA(ESTADOS[(i + paso + ESTADOS.length) % ESTADOS.length]);
  }

  botonesEstado.forEach(function (b) {
    b.addEventListener('click', function () { irA(b.dataset.ir); });
  });
  hoja.addEventListener('click', function (e) {
    if (!modoEscritorio.matches || e.target.closest('a')) return;
    avanzar(1);
  });

  // ---------------- Celular: paneles en orden de lectura ----------------
  var ORDEN = [1, 5, 2, 3, 4, 6];
  var caras = ORDEN.map(function (n) { return hoja.querySelector('.cara-' + n); });
  var listaPuntos = document.getElementById('lista-puntos');
  var flechas = document.querySelectorAll('[data-mover]');
  var actual = 0;

  caras.forEach(function (cara, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Panel ' + (i + 1) + ': ' + cara.dataset.nombre);
    b.addEventListener('click', function () { mostrar(i); });
    listaPuntos.appendChild(b);
  });

  // Distancia entre el inicio de un panel y el del siguiente (ancho + separación).
  function paso() {
    return caras[1].getBoundingClientRect().left - caras[0].getBoundingClientRect().left;
  }

  function mostrar(i) {
    i = Math.max(0, Math.min(caras.length - 1, i));
    var reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    hoja.scrollTo({ left: i * paso(), behavior: reducir ? 'auto' : 'smooth' });
    marcar(i);
  }

  function marcar(i) {
    actual = i;
    listaPuntos.querySelectorAll('button').forEach(function (b, j) {
      if (j === i) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    flechas[0].disabled = i === 0;
    flechas[1].disabled = i === caras.length - 1;
    if (!modoEscritorio.matches) indicador.textContent = (i + 1) + ' de 6 · ' + caras[i].dataset.nombre;
  }

  flechas.forEach(function (f) {
    f.addEventListener('click', function () { mostrar(actual + Number(f.dataset.mover)); });
  });

  // Al deslizar con el dedo, el panel actual es el más cercano a la posición de desplazamiento.
  var pendiente = false;
  hoja.addEventListener('scroll', function () {
    if (modoEscritorio.matches || pendiente) return;
    pendiente = true;
    requestAnimationFrame(function () {
      pendiente = false;
      var i = Math.round(hoja.scrollLeft / paso());
      if (i !== actual) marcar(Math.max(0, Math.min(caras.length - 1, i)));
    });
  }, { passive: true });

  // ---------------- Teclado y cambio de modo ----------------
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var paso = e.key === 'ArrowRight' ? 1 : -1;
    if (modoEscritorio.matches) avanzar(paso);
    else mostrar(actual + paso);
  });

  function aplicarModo() {
    if (modoEscritorio.matches) {
      irA(hoja.dataset.estado);
    } else {
      hoja.querySelectorAll('.cara').forEach(function (c) { c.removeAttribute('aria-hidden'); });
      marcar(actual);
    }
  }
  modoEscritorio.addEventListener('change', aplicarModo);
  aplicarModo();
})();
