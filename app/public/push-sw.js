// Eventos push del service worker. vite-plugin-pwa lo importa en el sw.js generado (importScripts).
// El servidor manda {titulo, cuerpo, url, tag} cifrado; aquí se muestra aunque la app esté cerrada.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { cuerpo: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.titulo || "RastreaYCompra", {
      body: d.cuerpo || "",
      icon: "/icono-512.png",
      badge: "/icono-512.png",
      tag: d.tag,
      data: { url: d.url || "/" },
    }),
  );
});

// Al tocarla: abre la oferta en la tienda, o la app si ya estaba abierta.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      if (url === "/" && ventanas.length) return ventanas[0].focus();
      return self.clients.openWindow(url);
    }),
  );
});
