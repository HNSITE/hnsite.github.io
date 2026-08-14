if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js",
        { updateViaCache: "none" }
      );
      await registration.update();
    } catch (error) {
      console.error("PWA service worker registration failed", error);
    }
  });
}
