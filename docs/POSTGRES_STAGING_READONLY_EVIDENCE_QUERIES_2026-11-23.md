# USERDIE Digital — staging PostgreSQL read-only evidence queries

**Дата:** 23.11.2026  
**Назначение:** сбор проверяемых сведений о PostgreSQL staging без изменения данных, схемы, ролей или привилегий.  
**Статус:** набор запросов подготовлен; фактическое выполнение в staging не проводилось.

> Выполнять только в изолированной staging-среде. Для проверки runtime-прав подключаться штатной API runtime identity (без `SET ROLE`). Для полного чтения системных каталогов отдельно использовать согласованную DBA/read-only identity. Не передавать пароли, connection strings, токены, environment dumps или персональные данные.

## Правила выполнения

1. Зафиксировать окружение и время UTC во внешнем протоколе.
2. Разделы 2–7 выполнять под API runtime identity. Историю миграций из раздела 8 — под отдельной read-only inspection identity, если runtime не имеет SELECT.
3. Запросы только читают системные каталоги и представления. Не выполнять DDL/DML, `GRANT`, `REVOKE`, `ALTER ROLE`, `SET ROLE` или миграции.
4. Не публиковать внутренние IP, hostnames, имена ролей и иные инфраструктурные идентификаторы в открытых issue. В публичном отчёте использовать псевдонимы.
5. Полный вывод хранить в контролируемом хранилище; зафиксировать оператора и независимого проверяющего.

Можно обернуть SELECT-запросы в read-only транзакцию:

```sql
BEGIN READ ONLY;
-- Выполнить SELECT-запросы ниже.
ROLLBACK;
```

## 1. Идентификация соединения и TLS

Выполнить под проверяемой runtime identity:

```sql
SELECT
  clock_timestamp() AT TIME ZONE 'UTC' AS observed_at_utc,
  current_database() AS database_name,
  session_user AS login_role,
  current_user AS effective_role,
  current_setting('server_version') AS postgres_version,
  s.ssl AS connection_uses_tls,
  s.version AS tls_version,
  s.cipher AS tls_cipher
FROM pg_stat_ssl AS s
WHERE s.pid = pg_backend_pid();
```

`ssl = true` подтверждает TLS только для текущего соединения. Это не доказывает клиентскую проверку сертификата (`rejectUnauthorized: true`) и не доказывает, что все соединения приложения используют TLS. Проверить клиентскую конфигурацию отдельно, не раскрывая секреты.

## 2. Атрибуты ролей и членство

```sql
SELECT
  r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
  r.rolcreaterole, r.rolinherit, r.rolreplication,
  r.rolbypassrls, r.rolvaliduntil,
  (r.rolname = session_user) AS is_login_role
FROM pg_roles AS r
WHERE r.rolname IN (session_user, current_user)
ORDER BY r.rolname;
```

```sql
SELECT
  member.rolname AS member_role,
  granted.rolname AS granted_role,
  m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members AS m
JOIN pg_roles AS member ON member.oid = m.member
JOIN pg_roles AS granted ON granted.oid = m.roleid
WHERE member.rolname IN (session_user, current_user)
ORDER BY member_role, granted_role;
```

Проверить всю цепочку наследования/доступа к привилегированным ролям, а не только прямое членство. Runtime identity не должна быть superuser, владельцем схемы/таблиц или иметь эффективные DDL/admin capabilities. PostgreSQL 16 учитывает `inherit_option` и `set_option`.

## 3. Владельцы и эффективные права на ключевые таблицы

```sql
WITH target_tables AS (
  SELECT c.oid, n.nspname, c.relname, c.relowner,
         pg_get_userbyid(c.relowner) AS owner_name
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'privacy_consent_documents', 'privacy_consent_events',
      'audit_events', 'app_users', 'schema_migrations'
    )
)
SELECT
  nspname, relname, owner_name,
  (owner_name = session_user) AS login_role_owns_object,
  has_table_privilege(current_user, oid, 'SELECT') AS can_select,
  has_table_privilege(current_user, oid, 'INSERT') AS can_insert,
  has_table_privilege(current_user, oid, 'UPDATE') AS can_update,
  has_table_privilege(current_user, oid, 'DELETE') AS can_delete,
  has_table_privilege(current_user, oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege(current_user, oid, 'REFERENCES') AS can_references,
  has_table_privilege(current_user, oid, 'TRIGGER') AS can_manage_triggers
FROM target_tables
ORDER BY relname;
```

Проверка схемы:

```sql
SELECT
  n.nspname,
  pg_get_userbyid(n.nspowner) AS schema_owner,
  has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use_schema,
  has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create_in_schema
FROM pg_namespace AS n
WHERE n.nspname = 'public';
```

Ориентир для consent ledger (не готовый GRANT-план):

| Объект | Минимум runtime | Критические запреты |
|---|---|---|
| `privacy_consent_documents` | SELECT | INSERT, UPDATE, DELETE, TRUNCATE, ownership |
| `privacy_consent_events` | SELECT, INSERT | UPDATE, DELETE, TRUNCATE, ownership |
| `audit_events` | INSERT только если требуется используемыми API-маршрутами | UPDATE, DELETE, TRUNCATE, ownership |
| `app_users` | SELECT, требуемый trigger-функцией; остальное — по фактическим API-запросам | Необоснованные UPDATE/DELETE/TRUNCATE, ownership |
| `schema_migrations` | Не требуется runtime для применения миграций | DDL и изменение журнала |

Для остальных таблиц права сверять с реальными SQL-операциями API. Не выдавать широкие права ради удобства.

## 4. Явные ACL, PUBLIC и column-level privileges

```sql
SELECT
  n.nspname, c.relname,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  pg_get_userbyid(acl.grantor) AS grantor,
  acl.privilege_type, acl.is_grantable
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(c.relacl, acldefault('r', c.relowner))
) AS acl
WHERE n.nspname = 'public'
  AND c.relname IN (
    'privacy_consent_documents', 'privacy_consent_events',
    'audit_events', 'app_users', 'schema_migrations'
  )
ORDER BY c.relname, grantee, acl.privilege_type;
```

```sql
SELECT
  n.nspname, c.relname,
  has_any_column_privilege(current_user, c.oid, 'SELECT') AS any_column_select,
  has_any_column_privilege(current_user, c.oid, 'INSERT') AS any_column_insert,
  has_any_column_privilege(current_user, c.oid, 'UPDATE') AS any_column_update,
  has_any_column_privilege(current_user, c.oid, 'REFERENCES') AS any_column_references
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'privacy_consent_documents', 'privacy_consent_events',
    'audit_events', 'app_users', 'schema_migrations'
  )
ORDER BY c.relname;
```

Проверить неожиданные grants для `PUBLIC`, `WITH GRANT OPTION`, column-level grants и grants промежуточным ролям. `has_table_privilege` и ACL нужно оценивать совместно с ownership и членством.

## 5. Триггеры и trigger functions migration 021

```sql
SELECT
  n.nspname AS table_schema, c.relname AS table_name,
  t.tgname AS trigger_name, t.tgenabled AS trigger_enabled_state,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_proc AS p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname IN ('privacy_consent_documents', 'privacy_consent_events')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
```

Обычно `O` означает enabled origin; `D` — disabled и требует расследования. `A` и `R` оценивать с учётом режима репликации. Сверить список с migration 021: append-only UPDATE/DELETE/TRUNCATE guards, immutable document guard, choice validation и event integrity.

## 6. SECURITY DEFINER и default privileges

```sql
SELECT
  n.nspname AS function_schema, p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege(current_user, p.oid, 'EXECUTE') AS runtime_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'prevent_privacy_consent_event_mutation',
    'protect_privacy_consent_document_versions',
    'prevent_privacy_consent_document_truncate',
    'validate_privacy_consent_document_choices',
    'enforce_privacy_consent_event_integrity'
  )
ORDER BY p.proname;
```

Для каждой `SECURITY DEFINER = true` функции проверить владельца, фиксированный безопасный `search_path`, EXECUTE и вызываемые объекты. Отсутствие SECURITY DEFINER само по себе не доказывает безопасность: trigger functions обычно исполняются с правами вызывающего пользователя, поэтому требуются минимальные SELECT-права на таблицы, читаемые функцией. Поле `runtime_can_execute` показывает возможность прямого вызова функции текущей ролью; оно не является самостоятельным критерием права на срабатывание уже созданного триггера. EXECUTE проверяется также для тех ролей, которые создают/изменяют триггеры, а не используется как замена анализу прав внутри trigger function.

```sql
SELECT
  n.nspname AS schema_name,
  pg_get_userbyid(d.defaclrole) AS creating_role,
  CASE WHEN d.defaclobjtype = 'r' THEN 'tables'
       WHEN d.defaclobjtype = 'S' THEN 'sequences'
       WHEN d.defaclobjtype = 'f' THEN 'functions'
       WHEN d.defaclobjtype = 'n' THEN 'schemas'
       ELSE d.defaclobjtype::text END AS object_type,
  d.defaclacl
FROM pg_default_acl AS d
LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public' OR d.defaclnamespace = 0
ORDER BY creating_role, object_type;
```

## 7. История миграций

Под отдельной read-only inspection identity, если runtime не имеет SELECT:

```sql
SELECT version, filename, checksum, applied_at
FROM public.schema_migrations
ORDER BY version;
```

Сверить version, filename и checksum с миграционными файлами того commit SHA, который развёрнут в staging. Не исправлять несовпадения вручную и не запускать мигратор в ходе аудита.

## 8. Критерии приёмки

- [ ] Runtime identity установлена через `session_user`; `SET ROLE` не использовался.
- [ ] Runtime не SUPERUSER, не владелец объектов/схемы и не имеет эффективных DDL/admin capabilities.
- [ ] Проверены прямые, PUBLIC, наследуемые, column-level и grant-option привилегии.
- [ ] Права на consent tables соответствуют утверждённой матрице; лишние UPDATE/DELETE/TRUNCATE/ownership отсутствуют.
- [ ] Все ожидаемые триггеры присутствуют и включены.
- [ ] SECURITY DEFINER функции, владельцы, search_path и EXECUTE проверены.
- [ ] Default privileges не открывают непредусмотренный доступ к будущим объектам.
- [ ] TLS подтверждён для соединения; клиентская проверка сертификата подтверждена отдельно.
- [ ] API и migration credentials различаются; секреты не раскрывались.
- [ ] Migration ledger/checksum совпадает с развёрнутым commit.
- [ ] Evidence независимо проверен и подписан.

Любой неизвестный, недоступный или противоречивый результат означает **NOT VERIFIED**, а не PASS.

## 9. Границы

Этот runbook не утверждает, что staging существует, доступен или уже проверен. Он не содержит credentials и не разрешает подключение к production. Запросы не запускались при создании документа. Не выполнять массовые `REVOKE/GRANT` и не менять migration 021 до отдельного change plan, проверки полного набора API SQL-операций и утверждения владельцем системы.
