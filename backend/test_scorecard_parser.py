import unittest

from scorecard_parser import parse_scorecard_text


class ParseScorecardTextTests(unittest.TestCase):
    def test_extracts_match_metadata_and_aggregates_player_rows(self):
        text = """Arik v/s Sandy
Arik won by 4 runs.
Arik 71-4 (7.0)
Batsman R B 4s 6s SR
Tatai (C) 3 5 0 0 60.00
Extras (2) 0 B, 0 LB, 2 WD, 0 NB, 0 P
Bowler O M R W ER
Sandy 1.2 0 5 1 4.17
Fall of wickets Score Over
Sandy 67-4 (7.0)
Batsman R B 4s 6s SR
Tatai 22 15 1 2 146.67
Bowler O M R W ER
Tatai 1.3 0 17 0 11.33
"""
        parsed = parse_scorecard_text(text, "Arik_vs_Sandy_1794051554464.pdf")

        self.assertEqual(parsed["title"], "Arik v/s Sandy")
        self.assertEqual(parsed["result"], "Arik won by 4 runs")
        self.assertEqual(parsed["date_source"], "filename_timestamp")
        self.assertEqual(
            parsed["batting"],
            [{"name": "Tatai", "runs": 25, "balls": 20, "fours": 1, "sixes": 2}],
        )
        self.assertEqual(
            parsed["bowling"],
            [
                {"name": "Sandy", "runs_conceded": 5, "wickets": 1, "overs": 1.2},
                {"name": "Tatai", "runs_conceded": 17, "wickets": 0, "overs": 1.3},
            ],
        )

    def test_does_not_infer_match_result_from_toss_line(self):
        parsed = parse_scorecard_text(
            "Subho v/s Rohit\nSubho won the toss and opted to Bat first.\nBatsman R B 4s 6s SR\n"
        )
        self.assertEqual(parsed["result"], "")
        self.assertTrue(parsed["warnings"])


if __name__ == "__main__":
    unittest.main()
