let timerId = null;
let timeLeft = 0;

self.onmessage = (e) => {
  if (e.data.type === 'START') {
    timeLeft = e.data.timeLeft;
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      timeLeft--;
      self.postMessage({ type: 'TICK', timeLeft });
      if (timeLeft <= 0) {
        clearInterval(timerId);
        self.postMessage({ type: 'EXPIRED' });
      }
    }, 1000);
  } else if (e.data.type === 'STOP') {
    if (timerId) clearInterval(timerId);
  }
};
