(function installApplicationGroups(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TraceApplicationGroups = api;
})(globalThis, function applicationGroupsModule() {
  'use strict';
  const MAX_NODES = 1000, MAX_NAME = 160;
  function serviceName(node) {
    for (const field of ['service', 'service-name', 'service_name', 'serviceName', 'instance-name', 'instance_name']) {
      const value = node?.[field];
      if (typeof value !== 'string') continue;
      const name = value.trim();
      if (name && name.length <= MAX_NAME && !/[\u0000-\u001f\u007f]/.test(name)) return name;
    }
    return '';
  }
  function nameTokens(value) {
    // Only explicit word separators count. A coincidental substring such as
    // online-bank inside online-banking never creates an application family.
    return value.toLowerCase().split(/[-_.]+/).filter(Boolean);
  }
  function group(nodes) {
    if (!Array.isArray(nodes)) return [];
    const records = nodes.slice(0, MAX_NODES).map((node, index) => {
      const name = serviceName(node), tokens = nameTokens(name);
      return { name, tokens, index, canonical: tokens.join('-') };
    });
    const buckets = new Map();
    for (const record of records) {
      // Names need two complete tokens before a visual family is considered.
      const key = record.tokens.length >= 2 ? record.tokens.slice(0, 2).join('\u0000') : null;
      if (key === null) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(record);
    }
    const covered = new Set(), result = [];
    for (const bucket of buckets.values()) {
      if (new Set(bucket.map(record => record.canonical)).size < 2) continue;
      let prefix = bucket[0].tokens.slice();
      for (const record of bucket.slice(1)) {
        let length = 0;
        while (length < prefix.length && length < record.tokens.length && prefix[length] === record.tokens[length]) length++;
        prefix = prefix.slice(0, length);
      }
      if (prefix.length < 2) continue;
      const nodeIndexes = bucket.map(record => record.index);
      nodeIndexes.forEach(index => covered.add(index));
      result.push({ label: prefix.join('-'), nodeIndexes, inferred: true });
    }
    const exact = new Map();
    for (const record of records) {
      if (covered.has(record.index)) continue;
      // Unrelated services remain separate even if a human-friendly label
      // looks similar. Missing names are merely an unnamed visual bucket.
      if (!exact.has(record.name)) exact.set(record.name, []);
      exact.get(record.name).push(record.index);
    }
    for (const [label, nodeIndexes] of exact) result.push({ label: label || 'Без названия', nodeIndexes, inferred: false });
    return result.sort((a, b) => a.nodeIndexes[0] - b.nodeIndexes[0]);
  }

  function classifyThread(value) {
    if (Array.isArray(value)) value = value.length === 1 ? value[0] : null;
    if (typeof value !== 'string' || value.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(value)) return 'unknown';
    const name = value.trim();
    if (!name) return 'unknown';
    // Naming conventions are display hints only. A thread name cannot prove
    // request ownership, asynchronous causality or concurrent execution.
    if (/(?:^|[.\s_-])(?:kafka|KafkaListenerEndpointContainer|KafkaMessageListenerContainer)(?:[.\s_#-]|$)|^(?:consumer|producer)-[^\s]*kafka/i.test(name)) return 'kafka';
    if (/^(?:reactor[-_.]|boundedElastic(?:-|$)|parallel-\d|single-\d)|(?:^|[.])reactor[.]/i.test(name)) return 'reactor';
    if (/(?:nio|epoll|kqueue)EventLoopGroup|(?:^|[._-])netty(?:[._-]|$)|(?:nio|epoll|kqueue)EventLoop-/i.test(name)) return 'netty';
    if (/^(?:scheduled|scheduling|scheduler)(?:[._-]|$)|(?:^|[._-])ScheduledThreadPool(?:Executor)?(?:[._-]|$)/i.test(name)) return 'scheduled';
    if (/^pool-\d+-thread-\d+$|^ForkJoinPool(?:[._-]|$)|^(?:worker|workers|executor|taskExecutor|task-executor)(?:[._-]|$)|(?:^|[._-])ThreadPoolTaskExecutor(?:[._-]|$)/i.test(name)) return 'worker-pool';
    return 'unknown';
  }
  return Object.freeze({ group, classifyThread });
});
