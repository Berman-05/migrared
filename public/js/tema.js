// Aplica el tema claro/oscuro antes de pintar la página, para que no destelle.
// La elección se guarda solo en este dispositivo; sin elección se sigue al sistema.
(function () {
  var tema;
  try { tema = localStorage.getItem('tema'); } catch (e) {}
  if (tema !== 'claro' && tema !== 'oscuro') tema = matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  document.documentElement.dataset.tema = tema;
})();
