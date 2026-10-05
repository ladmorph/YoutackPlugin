(function initializeKafkaErrorReference(root) {
  "use strict";
  // Static diagnostic guidance, not a parser or a severity verdict.
  // Matched only by the exception class name already recognized in the
  // event, the same way java-error-reference.js/integration-error-reference.js
  // are matched via lib/error-reference.js.
  const kafkaClients = "https://kafka.apache.org/38/javadoc/org/apache/kafka/common/errors/";
  const kafkaConsumer = "https://kafka.apache.org/38/javadoc/org/apache/kafka/clients/consumer/";
  const springKafka = "https://docs.spring.io/spring-kafka/docs/current/api/org/springframework/kafka/listener/";
  const entries = [
    {
      // The bare "TimeoutException" simple name already belongs to
      // java.util.concurrent.TimeoutException in java-error-reference.js;
      // matching only the fully-qualified name here avoids overwriting that
      // registration in lib/graylog/error-reference.js's byException map.
      id: "kafka.timeout", category: "kafka", exceptions: ["org.apache.kafka.common.errors.TimeoutException"],
      title: "Kafka: истекло время ожидания",
      meaning: "Клиент Kafka не получил подтверждение брокера или метаданные в отведённое время. Класс не указывает, что именно ждали: produce, метаданные или координатора группы.",
      causes: ["Брокер или раздел временно недоступны.", "Настроенный таймаут меньше фактической задержки сети или брокера."],
      checks: ["Определить конкретную операцию (produce/metadata/coordinator) по контексту события.", "Проверить доступность брокера и текущие таймауты клиента; единичный случай не доказывает деградацию кластера."],
      priority: "medium", source: kafkaClients + "TimeoutException.html"
    },
    {
      id: "kafka.not_leader", category: "kafka", exceptions: ["NotLeaderOrFollowerException", "org.apache.kafka.common.errors.NotLeaderOrFollowerException"],
      title: "Kafka: узел не является лидером раздела",
      meaning: "Запрос ушёл на брокер, который сейчас не лидер соответствующего раздела топика.",
      causes: ["Произошло переизбрание лидера раздела.", "Клиент использует устаревшие метаданные кластера."],
      checks: ["Проверить историю переизбраний лидера по разделу в это время.", "Обычно устраняется обновлением метаданных клиента; повторяемость важнее одного события."],
      priority: "medium", source: kafkaClients + "NotLeaderOrFollowerException.html"
    },
    {
      id: "kafka.record_too_large", category: "kafka", exceptions: ["RecordTooLargeException", "org.apache.kafka.common.errors.RecordTooLargeException"],
      title: "Kafka: сообщение превышает допустимый размер",
      meaning: "Отправленная запись больше лимита, настроенного на брокере или в клиенте.",
      causes: ["Сериализованное сообщение крупнее ожидаемого.", "Лимит размера сообщения на топике меньше, чем нужно приложению."],
      checks: ["Сверить фактический размер сообщения с лимитом топика (max.message.bytes) и клиента.", "Проверить формат сериализации; не увеличивать лимит без анализа причины роста."],
      priority: "medium", source: kafkaClients + "RecordTooLargeException.html"
    },
    {
      id: "kafka.unknown_topic_or_partition", category: "kafka", exceptions: ["UnknownTopicOrPartitionException", "org.apache.kafka.common.errors.UnknownTopicOrPartitionException"],
      title: "Kafka: топик или раздел не найден",
      meaning: "Брокер не знает запрошенный топик или раздел на момент запроса.",
      causes: ["Топик ещё не создан или создаётся асинхронно.", "Запрошен раздел, отсутствующий при текущей конфигурации топика."],
      checks: ["Проверить существование и конфигурацию топика в кластере.", "Если auto-create отключён, сверить процесс подготовки топика перед первым использованием."],
      priority: "medium", source: kafkaClients + "UnknownTopicOrPartitionException.html"
    },
    {
      id: "kafka.serialization", category: "kafka", exceptions: ["SerializationException", "org.apache.kafka.common.errors.SerializationException"],
      title: "Kafka: ошибка сериализации сообщения",
      meaning: "Настроенный сериализатор или десериализатор не смог обработать ключ или значение записи.",
      causes: ["Формат сообщения не совпадает с ожидаемой схемой.", "Несовместимая версия схемы между продюсером и консьюмером."],
      checks: ["Сверить конфигурацию serializer/deserializer с фактическим форматом сообщения.", "Проверить совместимость схемы между сторонами обмена; не публиковать содержимое сообщения при разборе."],
      priority: "medium", source: kafkaClients + "SerializationException.html"
    },
    {
      id: "kafka.commit_failed", category: "kafka", exceptions: ["CommitFailedException", "org.apache.kafka.clients.consumer.CommitFailedException"],
      title: "Kafka: не удалось зафиксировать offset",
      meaning: "Консьюмер не смог закоммитить offset — обычно потому, что группа уже перебалансировалась.",
      causes: ["Обработка сообщения заняла дольше max.poll.interval.ms.", "Консьюмер выпал из группы до отправки коммита."],
      checks: ["Сравнить длительность обработки батча с настройками poll interval и session timeout.", "Проверить логи ребалансировки группы в этом окне времени."],
      priority: "medium", source: kafkaConsumer + "CommitFailedException.html"
    },
    {
      id: "kafka.listener_failure", category: "kafka", exceptions: ["ListenerExecutionFailedException", "org.springframework.kafka.listener.ListenerExecutionFailedException"],
      title: "Kafka: обработчик Spring Kafka завершился с ошибкой",
      meaning: "Spring Kafka перехватил исключение из слушателя. Причина сбоя — во вложенном (cause) исключении, не в этом классе.",
      causes: ["Бизнес-логика обработчика выбросила исключение.", "Ошибка десериализации или преобразования сообщения перед вызовом обработчика."],
      checks: ["Проверить cause этого исключения — сама обёртка причину не определяет.", "Сверить настроенный ErrorHandler/retry и итоговую судьбу сообщения (повтор, DLQ, пропуск)."],
      priority: "medium", source: springKafka + "ListenerExecutionFailedException.html"
    }
  ];
  for (const entry of entries) {
    for (const value of Object.values(entry)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(entry);
  }
  const reference = Object.freeze(entries);
  root.KafkaErrorReference = reference;
  if (typeof module !== "undefined" && module.exports) module.exports = reference;
})(typeof globalThis !== "undefined" ? globalThis : this);
