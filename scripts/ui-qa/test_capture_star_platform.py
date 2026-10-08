#!/usr/bin/env python3
"""TASK-UX-QA-PREP-001 fault-injection and baseline tests for the Star Platform QA probes.

These tests never open a browser and never require a running dev server. They
drive the pure verdict functions that the browser probes call, inject the exact
defects the plan requires the probes to catch, and assert the probes report FAIL
instead of masquerading as PASS or SKIP.

The fault classes the probes must catch and report as FAIL (never PASS/SKIP):

* low text/background contrast below the WCAG AA floor;
* a primary CTA clipped outside the viewport;
* a declared primary CTA that the route fails to render;
* a route that answers with a non-success HTTP status;
* a language switch that unexpectedly fires a create/recommend/save POST;
* a language switch that leaves `html lang` or the current-language label behind.

A page that fails to load must be FAIL, and a real failure must never be silently
downgraded to SKIP. Only a legitimately disabled feature is SKIP, a missing
environment is NOT_EXECUTED, and a route with no primary CTA is NOT_MEASURED.
A matrix that is not fully PASS must never exit with the acceptance code 0.

Run with:

    python3 -m unittest discover -s scripts/ui-qa -p 'test_capture_star_platform.py'
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().with_name("capture_star_platform.py")


def _load_probe_module():
    """Import the sibling QA script by path so discovery location does not matter."""
    spec = importlib.util.spec_from_file_location("capture_star_platform", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load probe module from {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["capture_star_platform"] = module
    spec.loader.exec_module(module)
    return module


probes = _load_probe_module()

# The exact 73 machine-checkable validation checks recorded before this task. The
# probes may ADD checks, but every name below must still be produced, so no
# existing check can be silently deleted, renamed or weakened.
BASELINE_VALIDATION_CHECKS = (
    "reflow-320:home",
    "reflow-320:ai-design",
    "reflow-320:oracle-setup",
    "reflow-320:tarot-setup",
    "reflow-320:diy-workbench",
    "reflow-320:crystal-library",
    "reflow-320:gallery",
    "reflow-320:design-detail",
    "reflow-320:profile",
    "zoom-200:home",
    "zoom-200:ai-design",
    "zoom-200:oracle-setup",
    "zoom-200:tarot-setup",
    "zoom-200:diy-workbench",
    "zoom-200:crystal-library",
    "zoom-200:gallery",
    "zoom-200:design-detail",
    "zoom-200:profile",
    "reduced-motion:home",
    "reduced-motion:crystal-library",
    "contrast-aa:home",
    "contrast-aa:ai-design",
    "contrast-aa:oracle-setup",
    "contrast-aa:tarot-setup",
    "contrast-aa:diy-workbench",
    "contrast-aa:crystal-library",
    "contrast-aa:gallery",
    "contrast-aa:design-detail",
    "contrast-aa:profile",
    "touch-44:home",
    "touch-44:crystal-library",
    "touch-44:oracle-setup",
    "cta-visible:home",
    "cta-visible:ai-design",
    "cta-visible:oracle-setup",
    "cta-visible:tarot-setup",
    "cta-visible:diy-workbench",
    "cta-visible:crystal-library",
    "cta-visible:gallery",
    "cta-visible:design-detail",
    "cta-visible:profile",
    "overlay-center:home",
    "overlay-center:ai-design",
    "overlay-center:oracle-setup",
    "overlay-center:tarot-setup",
    "overlay-center:diy-workbench",
    "overlay-center:crystal-library",
    "overlay-center:gallery",
    "overlay-center:design-detail",
    "overlay-center:profile",
    "crystal-not-tinted:crystal-library",
    "crystal-not-tinted:diy-workbench",
    "capability-home-cards",
    "oracle-single-cast",
    "no-error-overlay:home",
    "no-error-overlay:ai-design",
    "no-error-overlay:oracle-setup",
    "no-error-overlay:tarot-setup",
    "no-error-overlay:diy-workbench",
    "no-error-overlay:crystal-library",
    "no-error-overlay:gallery",
    "no-error-overlay:design-detail",
    "no-error-overlay:profile",
    "keyboard-focus:home",
    "keyboard-focus:ai-design",
    "keyboard-focus:oracle-setup",
    "keyboard-focus:tarot-setup",
    "keyboard-focus:diy-workbench",
    "keyboard-focus:crystal-library",
    "keyboard-focus:gallery",
    "keyboard-focus:design-detail",
    "keyboard-focus:profile",
    "keyboard-complete:oracle",
)


class BaselineMatrixPreservationTests(unittest.TestCase):
    """The existing 73-case matrix must survive this task intact."""

    def test_baseline_inventory_is_exactly_73(self) -> None:
        self.assertEqual(len(BASELINE_VALIDATION_CHECKS), 73)
        self.assertEqual(len(set(BASELINE_VALIDATION_CHECKS)), 73)

    def test_planned_inventory_contains_every_baseline_check(self) -> None:
        planned = set(probes.validation_check_inventory())
        missing = [name for name in BASELINE_VALIDATION_CHECKS if name not in planned]
        self.assertEqual(missing, [], f"baseline checks disappeared: {missing}")

    def test_validation_route_set_is_unchanged(self) -> None:
        self.assertEqual(
            [route for route, _ in probes.VALIDATION_ROUTES],
            [
                "home",
                "ai-design",
                "oracle-setup",
                "tarot-setup",
                "diy-workbench",
                "crystal-library",
                "gallery",
                "design-detail",
                "profile",
            ],
        )


class ProbeDefinitionTests(unittest.TestCase):
    """The new probes must cover three locales, the required viewports and 200%."""

    def test_three_display_locales(self) -> None:
        self.assertEqual(list(probes.DISPLAY_LOCALES), ["zh-CN", "zh-TW", "en-US"])
        self.assertEqual(probes.DISPLAY_LOCALE_COOKIE, "mystcrag_locale")

    def test_required_viewports_present(self) -> None:
        names = [name for name, _, _ in probes.QA_VIEWPORTS]
        self.assertEqual(
            names, ["320x568", "390x844", "768x1024", "1440x900", "1440x560"]
        )

    def test_zoom_levels_include_200_percent(self) -> None:
        factors = dict(probes.QA_ZOOMS)
        self.assertEqual(factors["zoom-100"], 1.0)
        self.assertEqual(factors["zoom-200"], 2.0)

    def test_locale_screenshot_names_are_stable(self) -> None:
        name = probes.locale_screenshot_name("home", "zh-TW", "390x844", "zoom-200")
        self.assertEqual(name, "screenshots/home-zh-TW-390x844-zoom-200.png")


class ContrastFaultInjectionTests(unittest.TestCase):
    """A low-contrast measurement must turn the probe red."""

    def test_normal_text_below_aa_floor_fails(self) -> None:
        verdict = probes.contrast_verdict({"ratio": 2.1, "fontSize": 14, "bold": False})
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertEqual(verdict["floor"], 4.5)

    def test_large_text_uses_the_three_to_one_floor(self) -> None:
        verdict = probes.contrast_verdict({"ratio": 3.4, "fontSize": 30, "bold": False})
        self.assertEqual(verdict["status"], probes.PASS)
        self.assertEqual(verdict["floor"], 3.0)

    def test_large_text_below_three_to_one_fails(self) -> None:
        verdict = probes.contrast_verdict({"ratio": 2.9, "fontSize": 30, "bold": False})
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_healthy_contrast_passes(self) -> None:
        verdict = probes.contrast_verdict({"ratio": 7.2, "fontSize": 16, "bold": False})
        self.assertEqual(verdict["status"], probes.PASS)

    def test_unmeasurable_target_is_not_a_pass(self) -> None:
        verdict = probes.contrast_verdict(None)
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertNotIn(verdict["status"], {probes.PASS, probes.SKIP})


class CtaClipFaultInjectionTests(unittest.TestCase):
    """A clipped primary CTA must turn the probe red."""

    def test_cta_past_the_right_edge_fails(self) -> None:
        verdict = probes.cta_clip_verdict(
            {"height": 48, "left": 12, "right": 420, "viewportWidth": 390, "label": "启卦"}
        )
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_cta_off_the_left_edge_fails(self) -> None:
        verdict = probes.cta_clip_verdict(
            {"height": 48, "left": -4, "right": 200, "viewportWidth": 390, "label": "启卦"}
        )
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_collapsed_cta_fails(self) -> None:
        verdict = probes.cta_clip_verdict(
            {"height": 0, "left": 12, "right": 120, "viewportWidth": 390, "label": "启卦"}
        )
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_inside_cta_passes(self) -> None:
        verdict = probes.cta_clip_verdict(
            {"height": 48, "left": 12, "right": 378, "viewportWidth": 390, "label": "启卦"}
        )
        self.assertEqual(verdict["status"], probes.PASS)


class ExpectedCtaDeclarationTests(unittest.TestCase):
    """A route's declared primary CTA must be found, or the probe is not green."""

    def test_declared_cta_that_is_absent_fails(self) -> None:
        verdict = probes.expected_cta_verdict(None, ("button.oraclePrimaryAction",))
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertNotIn(verdict["status"], {probes.PASS, probes.SKIP})

    def test_route_without_a_cta_is_not_measured_never_pass(self) -> None:
        verdict = probes.expected_cta_verdict(None, None)
        self.assertEqual(verdict["status"], probes.NOT_MEASURED)
        self.assertNotEqual(verdict["status"], probes.PASS)
        self.assertNotEqual(verdict["status"], probes.SKIP)

    def test_declared_cta_present_and_inside_passes(self) -> None:
        verdict = probes.expected_cta_verdict(
            {"height": 48, "left": 8, "right": 300, "viewportWidth": 390, "label": "启卦"},
            ("button.oraclePrimaryAction",),
        )
        self.assertEqual(verdict["status"], probes.PASS)

    def test_declared_cta_present_but_clipped_fails(self) -> None:
        verdict = probes.expected_cta_verdict(
            {"height": 48, "left": 8, "right": 420, "viewportWidth": 390, "label": "启卦"},
            ("button.oraclePrimaryAction",),
        )
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_every_validation_route_declares_its_cta(self) -> None:
        declared = set(probes.ROUTE_PRIMARY_CTA)
        routes = {route for route, _ in probes.VALIDATION_ROUTES}
        self.assertEqual(
            routes - declared, set(), "a route has no primary CTA declaration"
        )

    def test_declarations_are_non_empty_selector_lists_or_none(self) -> None:
        for route, expected in probes.ROUTE_PRIMARY_CTA.items():
            if expected is None:
                continue
            self.assertTrue(expected, route)
            for selector in expected:
                self.assertIsInstance(selector, str)
                self.assertTrue(selector.strip(), route)


class RouteHttpStatusTests(unittest.TestCase):
    """A non-success document response is a FAIL, not a silent pass or a skip."""

    def test_server_error_is_fail(self) -> None:
        verdict = probes.route_response_verdict(500)
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_not_found_is_fail(self) -> None:
        self.assertEqual(probes.route_response_verdict(404)["status"], probes.FAIL)

    def test_missing_response_is_fail(self) -> None:
        self.assertEqual(probes.route_response_verdict(None)["status"], probes.FAIL)

    def test_success_is_pass(self) -> None:
        self.assertEqual(probes.route_response_verdict(200)["status"], probes.PASS)

    def test_non_success_is_never_skip(self) -> None:
        self.assertNotEqual(probes.route_response_verdict(500)["status"], probes.SKIP)


class LocaleLandingTests(unittest.TestCase):
    """After a switch the document and the header label must show the target."""

    def test_matching_lang_and_label_pass(self) -> None:
        verdict = probes.locale_landing_verdict("en-US", "English", "en-US")
        self.assertEqual(verdict["status"], probes.PASS)

    def test_wrong_html_lang_fails(self) -> None:
        verdict = probes.locale_landing_verdict("zh-CN", "English", "en-US")
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_wrong_current_label_fails(self) -> None:
        verdict = probes.locale_landing_verdict("en-US", "简体中文", "en-US")
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_traditional_chinese_label_is_expected(self) -> None:
        verdict = probes.locale_landing_verdict("zh-TW", "繁體中文", "zh-TW")
        self.assertEqual(verdict["status"], probes.PASS)

    def test_switch_check_fails_on_bad_landing(self) -> None:
        verdict = probes.locale_switch_check_verdict([], "zh-CN", "简体中文", "en-US")
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_switch_check_fails_on_unexpected_mutation(self) -> None:
        verdict = probes.locale_switch_check_verdict(
            [{"method": "POST", "url": "/api/design/save"}], "en-US", "English", "en-US"
        )
        self.assertEqual(verdict["status"], probes.FAIL)

    def test_quiet_switch_to_correct_language_passes(self) -> None:
        verdict = probes.locale_switch_check_verdict(
            [{"method": "GET", "url": "/api/catalog/materials"}],
            "en-US",
            "English",
            "en-US",
        )
        self.assertEqual(verdict["status"], probes.PASS)


class LocaleSwitchMutationFaultInjectionTests(unittest.TestCase):
    """A language switch must never create, recommend or save anything."""

    def test_every_mutation_kind_is_classified(self) -> None:
        cases = {
            ("POST", "/api/oracle/sessions"): "create",
            ("POST", "/api/tarot/sessions"): "create",
            ("POST", "/api/design/generate"): "create",
            ("POST", "/api/design/diy-first-bead"): "create",
            ("POST", "/api/design/clone"): "create",
            ("POST", "/api/orders/from-design"): "create",
            ("POST", "/api/design/recommend"): "recommend",
            ("POST", "/api/oracle/sessions/abc/recommendations"): "recommend",
            ("POST", "/api/materials/xyz/suggest"): "recommend",
            ("POST", "/api/design/save"): "save",
            ("POST", "/api/design/update"): "save",
        }
        for (method, url), expected in cases.items():
            self.assertEqual(probes.mutation_kind(method, url), expected, url)

    def test_reads_and_unrelated_posts_are_not_mutations(self) -> None:
        self.assertIsNone(probes.mutation_kind("GET", "/api/design/recommend"))
        self.assertIsNone(probes.mutation_kind("POST", "/api/auth/logout"))
        self.assertIsNone(probes.mutation_kind("POST", "/api/catalog/materials"))

    def test_quiet_language_switch_passes(self) -> None:
        verdict = probes.locale_switch_verdict(
            [{"method": "GET", "url": "/api/catalog/materials"}, {"method": "GET", "url": "/api/design/1"}]
        )
        self.assertEqual(verdict["status"], probes.PASS)
        self.assertEqual(verdict["unexpected"], [])

    def test_language_switch_that_creates_a_session_fails(self) -> None:
        verdict = probes.locale_switch_verdict([{"method": "POST", "url": "/api/oracle/sessions"}])
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertEqual(verdict["unexpected"][0]["kind"], "create")

    def test_language_switch_that_recommends_fails(self) -> None:
        verdict = probes.locale_switch_verdict([{"method": "POST", "url": "/api/design/recommend"}])
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertNotEqual(verdict["status"], probes.SKIP)

    def test_language_switch_that_saves_fails(self) -> None:
        verdict = probes.locale_switch_verdict([{"method": "POST", "url": "/api/design/save"}])
        self.assertEqual(verdict["status"], probes.FAIL)
        self.assertNotEqual(verdict["status"], probes.PASS)


class HonestStatusTests(unittest.TestCase):
    """Failures must be reported honestly and never downgraded to SKIP."""

    def test_page_load_failure_is_fail(self) -> None:
        self.assertEqual(probes.environment_status("page-load-failure"), probes.FAIL)

    def test_not_authenticated_is_blocked(self) -> None:
        self.assertEqual(probes.environment_status("not-authenticated"), probes.BLOCKED)

    def test_feature_disabled_is_skip(self) -> None:
        self.assertEqual(probes.environment_status("feature-disabled"), probes.SKIP)

    def test_infrastructure_unavailable_is_not_executed(self) -> None:
        self.assertEqual(
            probes.environment_status("infrastructure-unavailable"), probes.NOT_EXECUTED
        )

    def test_unknown_environment_kind_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            probes.environment_status("looks-fine-really")

    def test_a_real_failure_never_becomes_skip(self) -> None:
        failure_kinds = ("page-load-failure", "low-contrast", "cta-clipped", "unexpected-mutation")
        for kind in failure_kinds:
            self.assertEqual(probes.environment_status(kind), probes.FAIL, kind)
            self.assertNotEqual(probes.environment_status(kind), probes.SKIP, kind)

    def test_verdict_statuses_use_the_documented_vocabulary(self) -> None:
        allowed = {
            probes.PASS,
            probes.FAIL,
            probes.SKIP,
            probes.BLOCKED,
            probes.NOT_EXECUTED,
            probes.NOT_MEASURED,
        }
        for verdict in (
            probes.contrast_verdict({"ratio": 1.2, "fontSize": 12, "bold": False}),
            probes.cta_clip_verdict({"height": 48, "left": 0, "right": 900, "viewportWidth": 390}),
            probes.expected_cta_verdict(None, None),
            probes.locale_switch_verdict([{"method": "POST", "url": "/api/design/save"}]),
            probes.route_response_verdict(500),
            probes.locale_landing_verdict("zh-CN", "简体中文", "en-US"),
        ):
            self.assertIn(verdict["status"], allowed)


class MatrixExitCodeTests(unittest.TestCase):
    """A matrix that is not fully PASS must never exit with acceptance code 0."""

    def test_all_pass_is_zero(self) -> None:
        self.assertEqual(probes.matrix_exit_code([probes.PASS, probes.PASS]), 0)

    def test_a_failure_is_non_zero(self) -> None:
        self.assertEqual(probes.matrix_exit_code([probes.PASS, probes.FAIL]), 1)

    def test_blocked_alone_is_non_zero(self) -> None:
        self.assertNotEqual(probes.matrix_exit_code([probes.PASS, probes.BLOCKED]), 0)

    def test_skip_alone_is_non_zero(self) -> None:
        self.assertNotEqual(probes.matrix_exit_code([probes.PASS, probes.SKIP]), 0)

    def test_not_executed_alone_is_non_zero(self) -> None:
        self.assertNotEqual(probes.matrix_exit_code([probes.PASS, probes.NOT_EXECUTED]), 0)

    def test_not_measured_alone_is_non_zero(self) -> None:
        self.assertNotEqual(probes.matrix_exit_code([probes.PASS, probes.NOT_MEASURED]), 0)

    def test_failure_outranks_non_execution(self) -> None:
        self.assertEqual(
            probes.matrix_exit_code([probes.BLOCKED, probes.FAIL, probes.SKIP]), 1
        )

    def test_an_empty_matrix_is_zero(self) -> None:
        self.assertEqual(probes.matrix_exit_code([]), 0)

    def test_every_non_acceptance_status_is_non_zero(self) -> None:
        for status in sorted(probes.NON_ACCEPTANCE_STATUSES):
            self.assertNotEqual(probes.matrix_exit_code([status]), 0, status)


if __name__ == "__main__":
    unittest.main()