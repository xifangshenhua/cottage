/**
 * FIFO task queue with a concurrency cap. Used so the primary reply
 * is synthesized before any interjection, without blocking the caller.
 */

export function createQueue({ concurrency = 1 } = {}) {
  const pending = [];
  let active = 0;
  let waiters = [];

  function enqueue(task) {
    return new Promise((resolve, reject) => {
      pending.push({ task, resolve, reject });
      pump();
    });
  }

  function pump() {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active += 1;
      Promise.resolve()
        .then(() => job.task())
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
          flushIdle();
        });
    }
    flushIdle();
  }

  function flushIdle() {
    if (active === 0 && pending.length === 0 && waiters.length) {
      const list = waiters;
      waiters = [];
      for (const resolve of list) resolve();
    }
  }

  function idle() {
    if (active === 0 && pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => waiters.push(resolve));
  }

  function clear() {
    const dropped = pending.splice(0, pending.length);
    for (const job of dropped) job.reject(new Error("cancelled"));
    flushIdle();
    return dropped.length;
  }

  return {
    enqueue,
    idle,
    clear,
    get pending() { return pending.length; },
    get active() { return active; },
    get size() { return pending.length + active; },
  };
}
