// A worker's timer keeps running at full speed in a hidden tab, when the page's own timers are slowed to once a minute.
setInterval(() => postMessage(0), 1000);
