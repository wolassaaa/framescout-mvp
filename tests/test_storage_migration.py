import sqlite3
from pathlib import Path


MIGRATIONS = sorted(Path("crates/storage/migrations").glob("*.sql"))


def _db() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    for migration in MIGRATIONS:
        connection.executescript(migration.read_text(encoding="utf-8"))
    return connection


def _insert_project(connection: sqlite3.Connection, project_id: str = "project-1") -> None:
    connection.execute(
        """
        INSERT INTO projects (
          id, name, preset, source_roots_json, settings_json,
          created_at, updated_at, app_version
        )
        VALUES (?, 'Friday finals', 'matchday-story', '[]', '{}', '2026-07-11T00:00:00Z',
                '2026-07-11T00:00:00Z', 'test')
        """,
        (project_id,),
    )


def _insert_asset(
    connection: sqlite3.Connection,
    asset_id: str = "asset-1",
    project_id: str = "project-1",
    fingerprint: str = "frame.cr2::100::200",
) -> None:
    connection.execute(
        """
        INSERT INTO assets (
          id, project_id, source_path, file_fingerprint, preview_state,
          created_at, updated_at
        )
        VALUES (?, ?, 'D:/shoot/frame.cr2', ?, 'raw-placeholder',
                '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z')
        """,
        (asset_id, project_id, fingerprint),
    )
    connection.execute(
        """
        INSERT INTO decisions (
          asset_id, ai_disposition, human_disposition, reasons_json,
          revision, changed_at, actor
        )
        VALUES (?, 'keep', 'unseen', '[]', 0, '2026-07-11T00:00:00Z', 'system')
        """,
        (asset_id,),
    )


def test_migration_executes_and_creates_core_tables() -> None:
    connection = _db()
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }

    assert {
        "projects",
        "assets",
        "analysis_runs",
        "signals",
        "decisions",
        "decision_events",
        "tags",
        "tag_events",
        "asset_mappings",
        "export_runs",
        "cloud_requests",
    }.issubset(tables)


def test_asset_fingerprint_is_unique_within_project() -> None:
    connection = _db()
    _insert_project(connection)
    _insert_asset(connection)

    try:
        _insert_asset(connection, asset_id="asset-duplicate")
    except sqlite3.IntegrityError as exc:
        assert "UNIQUE" in str(exc)
    else:
        raise AssertionError("duplicate project asset fingerprint was accepted")


def test_human_decision_appends_history_event() -> None:
    connection = _db()
    _insert_project(connection)
    _insert_asset(connection)

    connection.execute(
        """
        UPDATE decisions
        SET human_disposition = 'select',
            revision = 1,
            changed_at = '2026-07-11T00:01:00Z',
            actor = 'human'
        WHERE asset_id = 'asset-1'
        """
    )

    event = connection.execute(
        """
        SELECT previous_human_disposition, next_human_disposition, actor, revision
        FROM decision_events
        WHERE asset_id = 'asset-1'
        """
    ).fetchone()

    assert event == ("unseen", "select", "human", 1)


def test_reanalysis_cannot_overwrite_human_disposition() -> None:
    connection = _db()
    _insert_project(connection)
    _insert_asset(connection)
    connection.execute(
        """
        UPDATE decisions
        SET human_disposition = 'select',
            revision = 1,
            changed_at = '2026-07-11T00:01:00Z',
            actor = 'human'
        WHERE asset_id = 'asset-1'
        """
    )

    try:
        connection.execute(
            """
            UPDATE decisions
            SET ai_disposition = 'review',
                human_disposition = 'unseen',
                revision = 2,
                changed_at = '2026-07-11T00:02:00Z',
                actor = 'system'
            WHERE asset_id = 'asset-1'
            """
        )
    except sqlite3.IntegrityError as exc:
        assert "reanalysis cannot overwrite a human disposition" in str(exc)
    else:
        raise AssertionError("reanalysis overwrote a human decision")


def test_project_delete_cascades_state_without_touching_source_paths() -> None:
    connection = _db()
    _insert_project(connection)
    _insert_asset(connection)

    connection.execute("DELETE FROM projects WHERE id = 'project-1'")

    assert connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0
    assert connection.execute("SELECT COUNT(*) FROM decisions").fetchone()[0] == 0


def test_tag_events_are_project_scoped_and_cascade_with_the_project() -> None:
    connection = _db()
    _insert_project(connection)
    _insert_asset(connection)

    connection.execute(
        """
        INSERT INTO tag_events (project_id, asset_ids_json, tag, mutation, changed_at, actor)
        VALUES ('project-1', '["asset-1"]', 'manual:hero', 'add', '2026-07-11T00:01:00Z', 'human')
        """
    )

    connection.execute("DELETE FROM projects WHERE id = 'project-1'")

    assert connection.execute("SELECT COUNT(*) FROM tag_events").fetchone()[0] == 0
