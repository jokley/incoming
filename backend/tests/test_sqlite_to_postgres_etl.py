import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, create_engine

from etl.sqlite_to_postgres import MigrationReport, Migrator, dependency_order, readonly_sqlite_engine


class SqliteToPostgresEtlTest(unittest.TestCase):
    def test_dependency_order_is_fk_order_not_alphabetical(self):
        metadata = MetaData()
        Table("z_parent", metadata, Column("id", Integer, primary_key=True))
        Table("a_child", metadata, Column("id", Integer, primary_key=True),
              Column("parent_id", ForeignKey("z_parent.id")))
        order, cyclic = dependency_order(metadata, {"a_child", "z_parent"})
        self.assertEqual(order, ["z_parent", "a_child"])
        self.assertEqual(cyclic, set())

    def test_cycle_columns_are_staged_for_second_pass(self):
        metadata = MetaData()
        left = Table("left_table", metadata, Column("id", Integer, primary_key=True),
                     Column("right_id", Integer, nullable=True))
        right = Table("right_table", metadata, Column("id", Integer, primary_key=True),
                      Column("left_id", ForeignKey("left_table.id"), nullable=True))
        # append a column-level FK after both tables exist
        left.c.right_id.append_foreign_key(ForeignKey("right_table.id"))
        _, cyclic = dependency_order(metadata, {"left_table", "right_table"})
        self.assertEqual(cyclic, {("left_table", "right_id"), ("right_table", "left_id")})

    def test_source_engine_enforces_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.db"
            connection = sqlite3.connect(path)
            connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")
            connection.execute("INSERT INTO sample(value) VALUES ('reference')")
            connection.commit()
            connection.close()
            engine = readonly_sqlite_engine(path)
            with engine.connect() as source:
                self.assertEqual(source.exec_driver_sql("SELECT count(*) FROM sample").scalar_one(), 1)
                with self.assertRaises(Exception):
                    source.exec_driver_sql("DELETE FROM sample")

    def test_legacy_single_room_status_is_backfilled_in_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "release-1.db"
            connection = sqlite3.connect(source_path)
            connection.execute(
                "CREATE TABLE athlete (id INTEGER PRIMARY KEY, single_room_entitlement VARCHAR(30))"
            )
            connection.executemany(
                "INSERT INTO athlete VALUES (?, ?)",
                [(1, "IN_QUOTA"), (2, "APPROVED_EXTRA"), (3, None), (4, "LEGACY_UNKNOWN")],
            )
            connection.commit()
            connection.close()
            checksum = hashlib.sha256(source_path.read_bytes()).hexdigest()

            target = create_engine("sqlite://")
            metadata = MetaData()
            Table(
                "athlete", metadata,
                Column("id", Integer, primary_key=True),
                Column("single_room_entitlement", String(30)),
                Column("single_room_status", String(30), nullable=False),
                Column("single_room_decision_id", Integer),
            )
            metadata.create_all(target)
            report = MigrationReport("now", True, str(source_path), "target")
            migrator = Migrator(readonly_sqlite_engine(source_path), target, report)

            _, first_rows, _ = migrator.analyze()
            _, second_rows, _ = migrator.analyze()

            expected = ["IN_QUOTA", "APPROVED_EXTRA", "NONE", "NONE"]
            self.assertEqual([row["single_room_status"] for row in first_rows["athlete"]], expected)
            self.assertEqual(second_rows, first_rows)
            self.assertNotIn("single_room_decision_id", first_rows["athlete"][0])
            self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), checksum)
            self.assertEqual(len(report.warnings), 1)

    def test_aligned_single_room_status_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "aligned.db"
            connection = sqlite3.connect(source_path)
            connection.execute(
                "CREATE TABLE athlete (id INTEGER PRIMARY KEY, single_room_entitlement VARCHAR(30), "
                "single_room_status VARCHAR(30) NOT NULL)"
            )
            connection.execute("INSERT INTO athlete VALUES (1, NULL, 'PENDING_APPROVAL')")
            connection.commit()
            connection.close()

            target = create_engine("sqlite://")
            metadata = MetaData()
            Table("athlete", metadata, Column("id", Integer, primary_key=True),
                  Column("single_room_entitlement", String(30)),
                  Column("single_room_status", String(30), nullable=False))
            metadata.create_all(target)
            report = MigrationReport("now", True, str(source_path), "target")

            _, rows, _ = Migrator(readonly_sqlite_engine(source_path), target, report).analyze()

            self.assertEqual(rows["athlete"][0]["single_room_status"], "PENDING_APPROVAL")
            self.assertEqual(report.warnings, [])


if __name__ == "__main__":
    unittest.main()
