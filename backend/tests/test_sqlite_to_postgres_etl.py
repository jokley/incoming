from pathlib import Path
import sqlite3
import tempfile
import unittest

from sqlalchemy import Column, ForeignKey, Integer, MetaData, Table

from etl.sqlite_to_postgres import dependency_order, readonly_sqlite_engine


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


if __name__ == "__main__":
    unittest.main()
