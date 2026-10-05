(function initializeIntegrationErrorReference(root) {
  "use strict";

  // Static diagnostic guidance, not a parser or a severity verdict.
  // Match only an observed exception token or a complete allowlisted ORA code.
  const entries = [
    {
      id: "oracle.unique", category: "oracle", oracleCodes: ["ORA-00001"],
      title: "Oracle: нарушена уникальность",
      meaning: "Запись создаёт дубликат значения уникального ограничения или индекса.",
      causes: ["Повторная обработка одной операции.", "Конкурирующие записи с одинаковым уникальным значением."],
      checks: ["Уточните нарушенное ограничение в исходной системе без выгрузки значений.", "Проверьте идемпотентность и конкурирующие транзакции; не отключайте ограничение автоматически."],
      priority: "medium", source: "https://docs.oracle.com/en/error-help/db/ora-00001/"
    },
    {
      id: "oracle.not_null", category: "oracle", oracleCodes: ["ORA-01400"],
      title: "Oracle: обязательное значение отсутствует",
      meaning: "INSERT пытается записать NULL в столбец, который его не допускает.",
      causes: ["Обязательное поле не заполнено до сохранения.", "Преобразование данных или схема не соответствуют ожиданиям приложения."],
      checks: ["Сопоставьте обязательность поля в контракте и схеме.", "Проверьте преобразование и значение по умолчанию без вывода клиентских данных."],
      priority: "medium", source: "https://docs.oracle.com/en/error-help/db/ora-01400/"
    },
    {
      id: "oracle.numeric_precision", category: "oracle", oracleCodes: ["ORA-01438"],
      title: "Oracle: число не помещается в точность столбца",
      meaning: "Число при INSERT или UPDATE превышает точность числового столбца.",
      causes: ["Результат расчёта вышел за допустимый диапазон.", "Точность схемы не согласована с единицами или округлением приложения."],
      checks: ["Сверьте precision и scale со схемой и правилами расчёта.", "Проверьте границы и округление на обезличенном примере; изменение типа требует отдельного решения."],
      priority: "medium", source: "https://docs.oracle.com/en/error-help/db/ora-01438/"
    },
    {
      id: "oracle.parent_missing", category: "oracle", oracleCodes: ["ORA-02291"],
      title: "Oracle: отсутствует родитель внешнего ключа",
      meaning: "Значение внешнего ключа не имеет соответствующей родительской записи.",
      causes: ["Дочерняя запись сохраняется раньше родительской.", "Внешний ключ указывает на отсутствующую или удалённую запись."],
      checks: ["Проверьте порядок сохранения и границы транзакции.", "Сверьте связь сущностей в исходной системе, не отключая проверку целостности автоматически."],
      priority: "medium", source: "https://docs.oracle.com/en/error-help/db/ora-02291/"
    },
    {
      id: "oracle.child_exists", category: "oracle", oracleCodes: ["ORA-02292"],
      title: "Oracle: удалению мешают дочерние записи",
      meaning: "Удаляемый родительский ключ ещё используется зависимыми записями.",
      causes: ["Операция удаления не учитывает существующие зависимости.", "Порядок удаления не соответствует ограничениям внешнего ключа."],
      checks: ["Проверьте связи и согласованные правила удаления.", "Уточните ожидаемое поведение приложения при зависимостях; не удаляйте данные автоматически."],
      priority: "medium", source: "https://docs.oracle.com/en/error-help/db/ora-02292/"
    },
    {
      id: "oracle.deadlock", category: "oracle", oracleCodes: ["ORA-00060"],
      title: "Oracle: взаимная блокировка транзакций",
      meaning: "Транзакции взаимно ожидают занятые друг другом ресурсы.",
      causes: ["Конкурирующие транзакции захватывают ресурсы в разном порядке.", "Пересекающиеся изменения удерживают взаимно необходимые блокировки."],
      checks: ["Изучите deadlock trace и участвующие транзакции вместе с DBA.", "Сверьте порядок блокировок и допустимость ограниченного повтора всей транзакции."],
      priority: "high", source: "https://docs.oracle.com/en/error-help/db/ora-00060/"
    },
    {
      id: "oracle.authentication", category: "oracle", oracleCodes: ["ORA-01017"],
      title: "Oracle: вход отклонён",
      meaning: "Предоставленные учётные данные или авторизация не позволяют войти в базу.",
      causes: ["Используется неверная или устаревшая конфигурация учётных данных.", "Для выбранного способа входа нет необходимой авторизации."],
      checks: ["Сверьте источник и актуальность настроек входа без вывода секретов.", "Попросите администратора проверить разрешённый способ входа и доступ."],
      priority: "high", source: "https://docs.oracle.com/en/error-help/db/ora-01017/"
    },
    {
      id: "oracle.connect_identifier", category: "oracle", oracleCodes: ["ORA-12154"],
      title: "Oracle: не разрешён идентификатор подключения",
      meaning: "Oracle Net не смог преобразовать идентификатор подключения в описание адреса.",
      causes: ["Неверный алиас или запись в используемом источнике имён.", "Процесс использует другое окружение или настройки разрешения имён."],
      checks: ["Сверьте используемый приложением алиас и способ разрешения имён.", "Проверьте доступность конфигурации Oracle Net именно из окружения процесса."],
      priority: "high", source: "https://docs.oracle.com/en/error-help/db/ora-12154/"
    },
    {
      id: "oracle.service_unregistered", category: "oracle", oracleCodes: ["ORA-12514"],
      title: "Oracle: listener не знает сервис",
      meaning: "Listener не располагает регистрацией запрошенного сервиса базы.",
      causes: ["В описании подключения указан неверный сервис.", "Сервис ещё не зарегистрирован или недоступен после запуска."],
      checks: ["Сверьте сервис подключения с доступными сервисами listener.", "Проверьте состояние базы и регистрацию сервиса вместе с DBA."],
      priority: "high", source: "https://docs.oracle.com/en/error-help/db/ora-12514/"
    },
    {
      id: "oracle.no_listener", category: "oracle", oracleCodes: ["ORA-12541"],
      title: "Oracle: listener недоступен по адресу подключения",
      meaning: "По указанному адресу подключения не найден доступный listener.",
      causes: ["Listener не запущен или слушает другой адрес.", "Описание подключения содержит неверный адрес, порт или IPC-ключ."],
      checks: ["Сверьте настройки подключения с конфигурацией listener.", "Проверьте состояние listener из доверенной среды администрирования."],
      priority: "high", source: "https://docs.oracle.com/en/error-help/db/ora-12541/"
    },
    {
      id: "redis.command_timeout", category: "redis", exceptions: ["RedisCommandTimeoutException"],
      title: "Redis/Lettuce: истекло ожидание команды",
      meaning: "Клиент не дождался завершения команды за отведённое время; итог выполнения на сервере из этого не следует.",
      causes: ["Команда или очередь обрабатывается дольше ожидаемого.", "Задержка сети либо остановка обработки на стороне клиента."],
      checks: ["Сопоставьте таймаут, задержки сервера и состояние клиента за тот же момент.", "Перед повтором записи проверьте идемпотентность: таймаут не доказывает, что запись не выполнена."],
      priority: "high", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisCommandTimeoutException.java"
    },
    {
      id: "redis.lettuce_connection", category: "redis", exceptions: ["RedisConnectionException"],
      title: "Redis/Lettuce: ошибка соединения",
      meaning: "Клиент сообщил сбой соединения; конкретная причина требует вложенного исключения.",
      causes: ["Недоступен адрес Redis или сетевой путь.", "Соединение прервано либо отклонено на этапе установки."],
      checks: ["Изучите вложенную причину: DNS, TCP, TLS или иной этап.", "Сопоставьте конфигурацию клиента и доступность Redis из окружения сервиса."],
      priority: "high", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisConnectionException.java"
    },
    {
      id: "redis.lettuce_command", category: "redis", exceptions: ["RedisCommandExecutionException"],
      title: "Redis/Lettuce: сервер вернул ошибку команды",
      meaning: "Redis вернул ответ об ошибке. Общий класс не устанавливает её конкретный тип.",
      causes: ["Команда или её аргументы не соответствуют допустимому контракту.", "Текущее состояние сервера не позволяет выполнить команду."],
      checks: ["Проверьте точный подкласс и безопасный код ответа в исходном журнале.", "Сверьте команду с версией и режимом Redis, не выводя ключи и значения."],
      priority: "medium", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisCommandExecutionException.java"
    },
    {
      id: "redis.script_missing", category: "redis", exceptions: ["RedisNoScriptException"],
      title: "Redis/Lettuce: Lua-скрипт отсутствует в кеше",
      meaning: "Redis не нашёл вызываемый по SHA1 Lua-скрипт.",
      causes: ["Скрипт не загружен в текущий узел.", "Кеш скриптов потерян после перезапуска, переключения или очистки."],
      checks: ["Проверьте предусмотренную клиентом загрузку скрипта при NOSCRIPT.", "Сопоставьте сбой с переключением узла и жизненным циклом кеша скриптов."],
      priority: "medium", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisNoScriptException.java"
    },
    {
      id: "redis.read_only", category: "redis", exceptions: ["RedisReadOnlyException"],
      title: "Redis/Lettuce: запись отклонена в режиме чтения",
      meaning: "Redis ответил READONLY; цель команды не принимает запись в текущем режиме.",
      causes: ["Запись направлена на реплику только для чтения.", "После переключения роли клиент использует прежнюю цель записи."],
      checks: ["Сверьте роль узла и маршрутизацию операций записи.", "Проверьте обновление топологии клиента после переключения; не разрешайте запись в реплику автоматически."],
      priority: "high", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisReadOnlyException.java"
    },
    {
      id: "redis.script_busy", category: "redis", exceptions: ["RedisBusyException"],
      title: "Redis/Lettuce: сервер занят Lua-скриптом",
      meaning: "Redis отклонил команду ответом BUSY во время выполнения Lua-скрипта.",
      causes: ["Скрипт выполняется слишком долго.", "Объём обрабатываемых скриптом данных вырос."],
      checks: ["Проверьте выполняемый скрипт и его вычислительную сложность без экспорта данных.", "Согласуйте восстановление с владельцем Redis; прерывание скрипта не всегда допустимо."],
      priority: "high", source: "https://raw.githubusercontent.com/redis/lettuce/main/src/main/java/io/lettuce/core/RedisBusyException.java"
    },
    {
      id: "redis.jedis_connection", category: "redis", exceptions: ["JedisConnectionException"],
      title: "Redis/Jedis: ошибка соединения",
      meaning: "Jedis сообщил ошибку соединения; без вложенной причины точный этап неизвестен.",
      causes: ["Соединение нельзя установить или оно было разорвано.", "Сетевая операция соединения завершилась ошибкой."],
      checks: ["Посмотрите вложенное исключение и этап сбоя в исходной системе.", "Сверьте доступность Redis и параметры соединения из окружения приложения."],
      priority: "high", source: "https://raw.githubusercontent.com/redis/jedis/master/src/main/java/redis/clients/jedis/exceptions/JedisConnectionException.java"
    },
    {
      id: "redis.jedis_command", category: "redis", exceptions: ["JedisDataException"],
      title: "Redis/Jedis: сервер вернул ошибку",
      meaning: "Клиент получил ответ Redis об ошибке. Название класса не доказывает повреждение данных.",
      causes: ["Команда не соответствует контракту или состоянию данных.", "Состояние сервера ограничивает выполнение команды."],
      checks: ["Уточните конкретный подкласс или код ответа в исходной системе.", "Сверьте команду с контрактом и режимом Redis; общий ERR не определяет причину."],
      priority: "medium", source: "https://raw.githubusercontent.com/redis/jedis/master/src/main/java/redis/clients/jedis/exceptions/JedisDataException.java"
    },
    {
      id: "network.netty_connect_timeout", category: "network", exceptions: ["ConnectTimeoutException"],
      title: "Netty: истекло время установки соединения",
      meaning: "Соединение не установлено до заданного срока. Это не доказывает, что целевой сервис остановлен.",
      causes: ["Установка соединения задерживается на сетевом пути или удалённой стороне.", "Лимит подключения слишком мал для наблюдаемых условий."],
      checks: ["С владельцем зависимости проверьте доступность слушающего сервиса и сетевой путь из окружения клиента.", "Сверьте connect timeout и момент ошибки; не определяйте виновную сторону только по исключению."],
      priority: "high", source: "https://netty.io/4.1/api/io/netty/channel/ConnectTimeoutException.html"
    },
    {
      id: "network.netty_read_timeout", category: "network", exceptions: ["ReadTimeoutException"],
      title: "Netty: данные не прочитаны в срок",
      meaning: "За установленный интервал не прочитаны данные. Это не обязательно полное время запроса и не доказательство медленного CPU сервера.",
      causes: ["Удалённая сторона не отправила данные в ожидаемый срок.", "Сеть или обработка входящих данных на клиенте задерживает чтение."],
      checks: ["С владельцем зависимости сопоставьте отправку и чтение данных за один интервал.", "Проверьте read timeout, сетевой путь и обработчики клиента; перед повтором записи уточните её исход."],
      priority: "high", source: "https://netty.io/4.1/api/io/netty/handler/timeout/ReadTimeoutException.html"
    },
    {
      id: "network.socket_timeout", category: "network", exceptions: ["SocketTimeoutException"],
      title: "Сеть: превышено время ожидания сокета",
      meaning: "Операция сокета не завершилась до таймаута. Класс сам по себе не определяет систему назначения.",
      causes: ["Удалённая сторона или доставка данных отвечает медленно.", "Лимит ожидания не соответствует длительности операции."],
      checks: ["Уточните по стеку фазу: соединение, чтение или ожидание входящего подключения.", "Сопоставьте лимиты и задержки обеих сторон; перед повтором записи проверьте её возможное выполнение."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/SocketTimeoutException.html"
    },
    {
      id: "network.unknown_host", category: "network", exceptions: ["UnknownHostException"],
      title: "Сеть: не удалось определить IP-адрес",
      meaning: "Java не смогла определить IP-адрес указанного имени узла.",
      causes: ["Имя задано неверно или отсутствует в используемом источнике имён.", "Разрешение имён недоступно из окружения приложения."],
      checks: ["Проверьте имя и разрешение DNS из того же окружения.", "Сопоставьте настройки резолвера и изменения окружения с моментом ошибки."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/UnknownHostException.html"
    },
    {
      id: "network.connect", category: "network", exceptions: ["ConnectException"],
      title: "Сеть: не установлено соединение",
      meaning: "Ошибка при подключении сокета к удалённому адресу и порту; часто это отказ соединения.",
      causes: ["По выбранному адресу и порту нет слушающего процесса.", "Сервис или промежуточный узел отклоняет подключение."],
      checks: ["Сверьте адрес подключения и наличие слушающего сервиса.", "Проверьте доступность из окружения клиента и вложенную системную причину."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/ConnectException.html"
    },
    {
      id: "network.no_route", category: "network", exceptions: ["NoRouteToHostException"],
      title: "Сеть: узел недостижим",
      meaning: "Подключение не достигло удалённого узла; возможна проблема маршрута или фильтрации.",
      causes: ["Недоступен промежуточный маршрутизатор или нужный маршрут.", "Межсетевой экран препятствует достижению узла."],
      checks: ["Проверьте маршруты из окружения клиента.", "Сопоставьте сетевые правила и доступность промежуточных узлов."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/NoRouteToHostException.html"
    },
    {
      id: "network.socket", category: "network", exceptions: ["SocketException"],
      title: "Сеть: общая ошибка сокета",
      meaning: "Произошла ошибка создания или использования сокета. Общий класс не доказывает конкретный вид разрыва.",
      causes: ["Соединение закрыто во время использования.", "Системная операция сокета завершилась ошибкой."],
      checks: ["Уточните подкласс, фазу операции и вложенную системную причину.", "Сопоставьте жизненный цикл соединения, события клиента и удалённой стороны."],
      priority: "medium", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/SocketException.html"
    },
    {
      id: "network.tls_handshake", category: "network", exceptions: ["SSLHandshakeException"],
      title: "TLS: не завершено согласование соединения",
      meaning: "Стороны не смогли согласовать необходимый уровень безопасности TLS.",
      causes: ["Сертификат или его цепочка не проходят ожидаемую проверку.", "Несовместимы протоколы, алгоритмы или требования аутентификации сторон."],
      checks: ["Изучите вложенную TLS-причину и согласованные параметры клиента и сервера.", "Проверьте срок, цепочку и доверие сертификата; не отключайте проверку TLS."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/net/ssl/SSLHandshakeException.html"
    },
    {
      id: "network.tls_peer", category: "network", exceptions: ["SSLPeerUnverifiedException"],
      title: "TLS: не подтверждена идентичность стороны",
      meaning: "Идентичность удалённой стороны не была проверена доступным механизмом аутентификации.",
      causes: ["Удалённая сторона не предоставила необходимое подтверждение идентичности.", "Используемый механизм аутентификации не позволяет проверить сторону."],
      checks: ["Уточните способ аутентификации и ожидаемую идентичность удалённой стороны.", "Проверьте настройки и материалы доверия без отключения проверки сертификатов."],
      priority: "high", source: "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/net/ssl/SSLPeerUnverifiedException.html"
    }
  ];

  for (const entry of entries) {
    for (const value of Object.values(entry)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(entry);
  }
  const reference = Object.freeze(entries);
  root.IntegrationErrorReference = reference;
  if (typeof module !== "undefined" && module.exports) module.exports = reference;
})(typeof globalThis !== "undefined" ? globalThis : this);
