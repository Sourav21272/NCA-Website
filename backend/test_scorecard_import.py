import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from database import Base
from models import Player
from scorecard_import import player_registry, prepare_scorecard_review


class PrepareScorecardReviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.db = Session(self.engine)
        self.players_by_name, self.existing_codes = player_registry(self.db)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_creates_missing_players_and_reuses_case_insensitive_names(self):
        first = """Arik v/s Sandy
Arik won by 4 runs.
Batsman R B 4s 6s SR
Tatai 3 5 0 0 60.00
Bowler O M R W ER
Sandy 1.2 0 5 1 4.17
"""
        first_review = prepare_scorecard_review(
            first,
            "Arik_vs_Sandy_1794051554464.pdf",
            self.db,
            self.players_by_name,
            self.existing_codes,
        )
        self.db.commit()

        second = """Sandy v/s Arik
Batsman R B 4s 6s SR
TATAI 8 4 1 0 200.00
"""
        second_review = prepare_scorecard_review(
            second,
            "Sandy_vs_Arik_1794051528544.pdf",
            self.db,
            self.players_by_name,
            self.existing_codes,
        )

        self.assertEqual(self.db.query(Player).count(), 2)
        self.assertEqual(
            first_review["batting"][0]["player_id"],
            second_review["batting"][0]["player_id"],
        )
        self.assertIsNone(self.db.query(Player).filter_by(name="Tatai").one().username)
        self.assertEqual(len(first_review["bowling"]), 1)


if __name__ == "__main__":
    unittest.main()
