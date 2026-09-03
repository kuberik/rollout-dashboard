import { describe, it, expect } from 'vitest';
import { isFieldManaged, isFieldManagedByManager, isFieldManagedByOtherManager, parseLinkAnnotations, extractDatadogInfoFromContainers, buildDatadogTestRunsUrl, buildDatadogLogsUrl, buildDatadogTraceSearchUrl, shortenVersion, formatTimeAgoCompact, formatDuration, plainMessage, detectStuckBehind } from './utils';
import {
    ENVIRONMENT_THEME_ANNOTATION,
    ENVIRONMENT_THEME_COLOR_ANNOTATION,
    ENVIRONMENT_THEME_LABEL_ANNOTATION,
    getEnvironmentThemeStyle,
    getRolloutEnvironmentTheme,
    mixWith,
    oklabChroma
} from './environment-theme';

describe('Field Manager Validation', () => {
    describe('isFieldManaged', () => {
        it('should correctly parse fieldsV1 YAML structure and validate field paths', () => {
            // Example fieldsV1 from a real Kubernetes resource
            const fieldsV1 = {
                'f:spec': {
                    'f:wantedVersion': {}
                }
            };

            expect(isFieldManaged(fieldsV1, 'spec.wantedVersion')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'metadata.name')).toBe(false);
            expect(isFieldManaged(fieldsV1, 'spec.otherField')).toBe(false);
        });

        it('should handle nested field paths correctly', () => {
            const fieldsV1 = {
                'f:spec': {
                    'f:healthCheckSelector': {
                        'f:matchLabels': {
                            'f:app': {}
                        }
                    }
                }
            };

            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels.app')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector.matchLabels.other')).toBe(false);
        });

        it('should handle empty or undefined fieldsV1', () => {
            expect(isFieldManaged('', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManaged({}, 'spec.wantedVersion')).toBe(false);
            expect(isFieldManaged(undefined, 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('isFieldManagedByManager', () => {
        it('should correctly identify when a specific manager owns a field', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:metadata': {
                            'f:labels': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(true);
            expect(isFieldManagedByManager(managedFields, 'kubectl', 'metadata.labels')).toBe(true);
            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'metadata.labels')).toBe(false);
            expect(isFieldManagedByManager(managedFields, 'kubectl', 'spec.wantedVersion')).toBe(false);
        });

        it('should handle empty or undefined managedFields', () => {
            expect(isFieldManagedByManager([], 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByManager(undefined as any, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });

        it('should handle fields without fieldsV1', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: undefined
                }
            ];

            expect(isFieldManagedByManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('isFieldManagedByOtherManager', () => {
        it('should correctly identify when other managers own a field', () => {
            const managedFields = [
                {
                    manager: 'rollout-dashboard',
                    fieldsV1: {
                        'f:metadata': {
                            'f:annotations': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(true);
            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'metadata.annotations')).toBe(false);
            expect(isFieldManagedByOtherManager(managedFields, 'kubectl', 'spec.wantedVersion')).toBe(false);
        });

        it('should ignore empty manager names', () => {
            const managedFields = [
                {
                    manager: '',
                    fieldsV1: {
                        'f:spec': {
                            'f:wantedVersion': {}
                        }
                    }
                },
                {
                    manager: 'kubectl',
                    fieldsV1: {
                        'f:metadata': {
                            'f:labels': {}
                        }
                    }
                }
            ];

            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByOtherManager(managedFields, 'rollout-dashboard', 'metadata.labels')).toBe(true);
        });

        it('should handle empty or undefined managedFields', () => {
            expect(isFieldManagedByOtherManager([], 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
            expect(isFieldManagedByOtherManager(undefined as any, 'rollout-dashboard', 'spec.wantedVersion')).toBe(false);
        });
    });

    describe('Real-world examples', () => {
        it('should handle the example from the attached file', () => {
            // This is a real fieldsV1 example from the attached file
            const fieldsV1 = {
                'f:metadata': {
                    'f:annotations': {
                        '.': {},
                        'f:dashboard.rollout.kuberik.com/description': {},
                        'f:kubectl.kubernetes.io/last-applied-configuration': {}
                    },
                    'f:labels': {
                        '.': {},
                        'f:environment': {}
                    }
                },
                'f:spec': {
                    '.': {},
                    'f:healthCheckSelector': {},
                    'f:minBakeTime': {},
                    'f:releasesImagePolicy': {},
                    'f:versionHistoryLimit': {}
                }
            };

            expect(isFieldManaged(fieldsV1, 'metadata.annotations')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'metadata.labels.environment')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.healthCheckSelector')).toBe(true);
            expect(isFieldManaged(fieldsV1, 'spec.wantedVersion')).toBe(false); // This field is not managed
            expect(isFieldManaged(fieldsV1, 'spec.releasesImagePolicy')).toBe(true);
        });
    });
});

describe('parseLinkAnnotations', () => {
    it('should return empty array for undefined annotations', () => {
        expect(parseLinkAnnotations(undefined)).toEqual([]);
    });

    it('should return empty array for empty annotations', () => {
        expect(parseLinkAnnotations({})).toEqual([]);
    });

    it('should return empty array when no annotations match the link prefix', () => {
        const annotations = {
            'kubectl.kubernetes.io/last-applied-configuration': '{}',
            'rollout.kuberik.com/bypass-gates': 'v1.2.3'
        };
        expect(parseLinkAnnotations(annotations)).toEqual([]);
    });

    it('should extract a single link annotation', () => {
        const annotations = {
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs'
        };
        expect(parseLinkAnnotations(annotations)).toEqual([
            { label: 'Logs', url: 'https://example.com/logs' }
        ]);
    });

    it('should extract multiple link annotations', () => {
        const annotations = {
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs',
            'rollout.kuberik.com/link.CI': 'https://example.com/ci'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ label: 'Logs', url: 'https://example.com/logs' });
        expect(result).toContainEqual({ label: 'CI', url: 'https://example.com/ci' });
    });

    it('should ignore non-link annotations mixed in', () => {
        const annotations = {
            'kubectl.kubernetes.io/last-applied-configuration': '{}',
            'rollout.kuberik.com/link.Logs': 'https://example.com/logs',
            'rollout.kuberik.com/bypass-gates': 'v1.0.0',
            'rollout.kuberik.com/link.CI': 'https://example.com/ci'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ label: 'Logs', url: 'https://example.com/logs' });
        expect(result).toContainEqual({ label: 'CI', url: 'https://example.com/ci' });
    });

    it('should preserve the full URL value including encoded characters', () => {
        const annotations = {
            'rollout.kuberik.com/link.CI': 'https://app.datadoghq.com/ci/test/runs?query=test_level%3Atest%20-%40ci.provider.name%3Agithub%20%40test.service%3Amyservice%20%40version%3Av1.0.0'
        };
        const result = parseLinkAnnotations(annotations);
        expect(result).toEqual([
            {
                label: 'CI',
                url: 'https://app.datadoghq.com/ci/test/runs?query=test_level%3Atest%20-%40ci.provider.name%3Agithub%20%40test.service%3Amyservice%20%40version%3Av1.0.0'
            }
        ]);
    });
});

describe('environment themes', () => {
    it('returns null when a rollout has no theme annotations', () => {
        expect(getRolloutEnvironmentTheme({ metadata: { annotations: {} } } as any)).toBeNull();
        expect(getRolloutEnvironmentTheme(null)).toBeNull();
    });

    // THE IDENTITY RAMP IS THE ORIGINAL, AND IT IS CLOSED (2026-08-25).
    //
    // dev #16a34a · staging #7c3aed · prod #d97706 · test #0891b2. Four rounds
    // of hue-solving replaced them (amber -> slate -> rust #7c2d12 -> #8f3b00
    // -> magenta #b50e91) and the human rejected every one:
    //
    //   "they need to fit in with the rest of the colors of the pages. i don't
    //    know why you changed them in the first place. the one we had
    //    originally before you started doing changes were completely fine."
    //
    // Those rounds were each a locally correct fix to a measured collision, so
    // the tests they left behind assert the OPPOSITE of what is now true —
    // `expect(dev).not.toBe('#16a34a')` asserts that the human's own decision
    // is a bug. They are rewritten below, not loosened.
    //
    // TWO OF THESE SEEDS DO COLLIDE WITH A STATUS HUE, deliberately, and each
    // collision is resolved on the STATUS mark instead:
    //   · prod is amber, the `stuck` family -> `rank` (`−N`) gave up amber and
    //     took red; `alarm` stays the only chip with a fill AND a glyph AND a
    //     coloured border, so it still outranks every identity mark.
    //   · dev is green, the `Succeeded` family -> "one green" became "one green
    //     FOR STATE"; identity is separated by SHAPE. Guarded below.
    it('maps production to the amber preset, and keeps it clear of red', () => {
        // There is nothing left for a COLOUR test to assert about prod vs the
        // `stuck` amber: they share a hue family on purpose and are separated
        // by mark, not hue. What is still a real guard — and matters more than
        // it did — is prod's distance from RED. Red is now the ink of `Failed`,
        // `diverged` AND `rank`, and on `/apps` a `−N` chip renders as the very
        // next half of the SAME joined box as a prod env chip. Drift prod back
        // toward rust and those two halves stop being separable at 11px.
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'prod'
                }
            }
        } as any);

        expect(theme?.label).toBe('Production');
        expect(theme?.color).toBe('#d97706');
        expect(hueGap(theme!.color, '#c10007')).toBeGreaterThan(25); // red-700
        expect(hueGap(theme!.color, '#ff6467')).toBeGreaterThan(25); // red-400
    });

    it('infers production from an Environment name containing prod', () => {
        const theme = getRolloutEnvironmentTheme({ metadata: { annotations: {} } } as any, 'eu-prod-1');

        // FIXED 2026-08-27. `resolveThemeLabel` used to return the preset word
        // `Production` here, which collapsed `eu-prod-1`, `us-prod-2` and
        // `ap-prod-1` onto one indistinguishable mark. An environment's label
        // is its own name; the preset word survives only for a rollout that
        // declares a theme with no Environment attached.
        expect(theme?.label).toBe('eu-prod-1');
        expect(theme?.color).toBe('#d97706');
    });

    it('infers development from Environment spec.environment', () => {
        const theme = getRolloutEnvironmentTheme(
            { metadata: { annotations: {} } } as any,
            { spec: { environment: 'development-west' } } as any
        );

        // Same rule as above: the identity was inferred FROM this name, so the
        // name is what prints.
        expect(theme?.label).toBe('development-west');
        expect(theme?.color).toBe('#16a34a');
    });

    it('lets a theme annotation override the inferred environment theme', () => {
        const theme = getRolloutEnvironmentTheme(
            {
                metadata: {
                    annotations: {
                        [ENVIRONMENT_THEME_ANNOTATION]: 'dev'
                    }
                }
            } as any,
            'eu-prod-1'
        );

        expect(theme?.label).toBe('Development');
        expect(theme?.color).toBe('#16a34a');
    });

    it('lets a custom color annotation override the inferred environment color', () => {
        const theme = getRolloutEnvironmentTheme(
            {
                metadata: {
                    annotations: {
                        [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#0EA5E9'
                    }
                }
            } as any,
            'eu-prod-1'
        );

        // A `theme-color` annotation recolours the chip; it does not rename the
        // environment. The colour comes from the annotation (and therefore from
        // `computedRamp`/`mixWith`, the one surviving caller); the word still
        // comes from the environment.
        expect(theme?.label).toBe('eu-prod-1');
        expect(theme?.color).toBe('#0ea5e9');
    });

    it('keeps dev identity and the Succeeded green apart by SHAPE, not by hue', () => {
        // THIS TEST'S PREMISE WAS INVERTED, so its name changed with it. It used
        // to be `maps development to the cyan preset theme, not the Succeeded
        // green` and asserted `expect(color).not.toBe('#16a34a')` — i.e. it
        // asserted that the value the human chose is a bug.
        //
        // dev IS the success hue now: #16a34a is OKLCH hue 149.2 and green-700
        // is 149.0. The RULE moved instead of the colour. "There is exactly ONE
        // green" became "there is exactly one green FOR STATE; identity is a
        // separate axis" — and what keeps the two from reading as two instances
        // of one signal is that they are never the same MARK:
        //
        //   · a state green is a FILLED disc or a check ring: no border, no
        //     text, chroma ~0.15 across its whole area.
        //   · an identity green is a bordered RECTANGLE that always prints its
        //     own name, whose fill is a 90% white mix — an order of presence
        //     quieter than the disc's ink.
        //
        // That is the invariant worth guarding, because it is the one whose
        // breakage would actually reintroduce the defect: give the dev chip a
        // saturated fill and it becomes a green blob beside a green disc, and
        // the shape argument collapses.
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'development'
                }
            }
        } as any);

        expect(theme?.label).toBe('Development');
        expect(theme?.color).toBe('#16a34a');

        // Same hue as the success green — STATED, not avoided, so that a future
        // edit which "fixes" it by re-hueing dev fails here and has to come read
        // this comment first.
        expect(hueGap(theme!.color, '#008236')).toBeLessThan(2);

        // ...and separated on the axis that actually does the work: the chip's
        // FILL is nowhere near the disc's ink.
        expect(oklabChroma(theme!.surfaceColor)).toBeLessThan(oklabChroma('#008236') * 0.2);
        // A chip is a rectangle with an edge, never a blob.
        expect(theme!.borderColor).not.toBe(theme!.surfaceColor);
    });

    it('uses a custom hex color annotation with an optional label', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#0EA5E9',
                    [ENVIRONMENT_THEME_LABEL_ANNOTATION]: 'Sandbox'
                }
            }
        } as any);

        expect(theme?.label).toBe('Sandbox');
        expect(theme?.color).toBe('#0ea5e9');
    });

    it('rejects invalid custom color values', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: 'url(https://example.com/image.png)'
                }
            }
        } as any);

        expect(theme).toBeNull();
    });

    it('returns CSS variables for a parsed theme', () => {
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'staging'
                }
            }
        } as any);

        expect(theme).not.toBeNull();
        expect(getEnvironmentThemeStyle(theme!)).toContain('--rollout-theme-accent: #7c3aed');
    });

    // ── THE RESTORED PALETTE ────────────────────────────────────────────────
    //
    // These four seeds and the two fixed mixes that derive from them are the
    // palette the human calls "completely fine". What they guard is no longer a
    // solved invariant — it is the exact values, and the fact that the
    // DERIVATION was reverted with them. Restoring the seeds alone would have
    // restored the hues at the wrong weights.
    //
    // `hueGap` is declared here but used by tests ABOVE it, which is safe: a
    // `describe` body runs to completion during collection, so every `const` in
    // it is initialised before any `it` callback executes.
    const oklabHue = (hex: string) => {
        const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s2 = Math.cbrt(0.088302462 * r + 0.2817188376 * g + 0.6299787005 * b);
        const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2;
        const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2;
        const h = (Math.atan2(B, A) * 180) / Math.PI;
        return h < 0 ? h + 360 : h;
    };

    /** Shortest angular distance between two hues, in degrees. */
    const hueGap = (a: string, b: string) => {
        const d = Math.abs(oklabHue(a) - oklabHue(b));
        return Math.min(d, 360 - d);
    };

    const themeFor = (name: string) =>
        getRolloutEnvironmentTheme(
            { metadata: { annotations: { [ENVIRONMENT_THEME_ANNOTATION]: name } } } as any
        )!;

    it('uses the original four identity seeds', () => {
        expect(themeFor('dev').color).toBe('#16a34a');
        expect(themeFor('staging').color).toBe('#7c3aed');
        expect(themeFor('prod').color).toBe('#d97706');
        expect(themeFor('test').color).toBe('#0891b2');
    });

    // ── COMPUTED → CHOSEN (2026-08-27) ──────────────────────────────────────
    //
    // THIS TEST USED TO ASSERT THE MIXES, and it was right to until the mixes
    // were the defect. It read:
    //
    //     expect(prod.borderColor).toBe('#f1cea5');   // mixWith(seed, #fff, .64)
    //     expect(prod.surfaceColor).toBe('#fbf1e6');  // mixWith(seed, #fff, .90)
    //
    // Five derivations x four environments produced TWENTY colours that exist
    // in no palette and have no designed relationship to one another, which is
    // why `prod` ink measured 4.18:1 and `dev` 4.33:1 over their own fills at
    // 10px — both under the 4.5 floor, and neither pair chosen by anyone.
    //
    // THE SEEDS DID NOT MOVE. The supporting values are Tailwind v4 steps from
    // each seed's own ramp now, in both themes. If you are here because this
    // test failed: do NOT restore a mix. Change the step, and record the new
    // contrast in DESIGN.md.
    it('paints the presets from CHOSEN Tailwind steps, never from a mix', () => {
        const prod = themeFor('prod');
        expect(prod.textColor).toBe('#7b3306'); // amber-900
        expect(prod.borderColor).toBe('#fee685'); // amber-200
        expect(prod.surfaceColor).toBe('#fffbeb'); // amber-50
        expect(prod.darkSurfaceColor).toBe('#461901'); // amber-950
        expect(prod.darkBorderColor).toBe('#973c00'); // amber-800
        expect(prod.darkTextColor).toBe('#fef3c6'); // amber-100

        const staging = themeFor('staging');
        expect(staging.textColor).toBe('#5d0ec0'); // violet-800
        expect(staging.borderColor).toBe('#c4b4ff'); // violet-300
        expect(staging.surfaceColor).toBe('#f5f3ff'); // violet-50
        expect(staging.darkSurfaceColor).toBe('#2f0d68'); // violet-950
        expect(staging.darkBorderColor).toBe('#4d179a'); // violet-900
        expect(staging.darkTextColor).toBe('#ddd6ff'); // violet-200

        expect(themeFor('dev').textColor).toBe('#008236'); // green-700
        expect(themeFor('test').textColor).toBe('#007595'); // cyan-700

        // NOT a mix of its own seed, on any channel. This is the assertion that
        // fails first if someone reintroduces the derivation.
        for (const name of ['dev', 'staging', 'prod', 'test']) {
            const t = themeFor(name);
            expect(t.borderColor).not.toBe(mixWith(t.color, '#ffffff', 0.64));
            expect(t.surfaceColor).not.toBe(mixWith(t.color, '#ffffff', 0.9));
            expect(t.textColor).not.toBe(mixWith(t.color, '#000000', 0.18));
        }
    });

    it('keeps the computed fallback for a hand-picked colour, unchanged', () => {
        // A `theme-color` annotation is an arbitrary hex. It has NO RAMP, so
        // there are no steps to choose and `mixWith` is still the answer — this
        // is the one path it is allowed on. The values below are byte for byte
        // what a custom env rendered before the presets moved to chosen steps,
        // including `darkBorderColor`, which used to be produced in CSS as
        // `color-mix(in srgb, accent 38%, gray-700)` and is stated in TS now.
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#0EA5E9',
                    [ENVIRONMENT_THEME_LABEL_ANNOTATION]: 'Sandbox'
                }
            }
        } as any)!;

        expect(theme.color).toBe('#0ea5e9');
        expect(theme.textColor).toBe(mixWith('#0ea5e9', '#000000', 0.18));
        expect(theme.borderColor).toBe(mixWith('#0ea5e9', '#ffffff', 0.64));
        expect(theme.surfaceColor).toBe(mixWith('#0ea5e9', '#ffffff', 0.9));
        expect(theme.darkSurfaceColor).toBe(mixWith('#0ea5e9', '#000000', 0.7));
        expect(theme.darkTextColor).toBe(mixWith('#0ea5e9', '#ffffff', 0.42));
        expect(theme.darkBorderColor).toBe(mixWith('#0ea5e9', '#364153', 0.62));
    });

    it('does not let a custom colour hijack a preset ramp', () => {
        // `prod` + an explicit hex: the NAME still resolves the preset (so the
        // label stays `Production`), but the COLOUR is hand-picked, so every
        // supporting value must come from the computed fallback rather than
        // from amber's chosen steps.
        const theme = getRolloutEnvironmentTheme({
            metadata: {
                annotations: {
                    [ENVIRONMENT_THEME_ANNOTATION]: 'prod',
                    [ENVIRONMENT_THEME_COLOR_ANNOTATION]: '#b50e91'
                }
            }
        } as any)!;

        expect(theme.color).toBe('#b50e91');
        expect(theme.borderColor).toBe(mixWith('#b50e91', '#ffffff', 0.64));
        expect(theme.borderColor).not.toBe('#fee685');
    });

    it('has no bandColor — the surface IS the band mix again', () => {
        // `bandColor` existed only to hold the old 90% mix once `surfaceColor`
        // was solved to something stronger. With the 90% mix back where it was,
        // it was the same value under a second name and no CSS read it.
        const prod = themeFor('prod') as unknown as Record<string, unknown>;
        expect(prod.bandColor).toBeUndefined();
        expect(getEnvironmentThemeStyle(themeFor('prod'))).not.toContain('--rollout-theme-band');
    });

    it('keeps every env surface far below the `stuck` chip fill', () => {
        // THE ONE INVARIANT THAT SURVIVES THE REVERT, and the reason prod may
        // share amber's hue family without becoming an alarm. `alarm` is the
        // only chip with a fill AND a glyph AND a coloured border; the widest
        // margin is the fill. amber-200 is oklch(.924 .12 95.746) = 0.120 here,
        // and the loudest env surface (staging) is 0.025 — 4.8x quieter. Prod's
        // is 0.018, 6.6x quieter.
        const alarmFill = oklabChroma('#fee685');
        for (const name of ['dev', 'staging', 'test', 'prod']) {
            expect(oklabChroma(themeFor(name).surfaceColor)).toBeLessThan(alarmFill * 0.25);
        }
    });

    it('keeps the `rank` red separable from production’s ink', () => {
        // THE RULE MOVED, NOT THE COLOUR. `rank` (`−N`) gave amber up and took
        // the product's red, the hue `diverged` already prints in, because on
        // `/apps` a `−N` chip renders as the very next half of the SAME joined
        // box as a prod env chip.
        //
        // ⚠️ THIS TEST USED TO MEASURE HUE ALONE (`hueGap > 25`) AND HUE ALONE
        // IS THE WRONG INSTRUMENT when the two inks differ in lightness and
        // chroma as well. Tailwind's amber ramp is NOT iso-hue — amber-600 is
        // hue 58.3 but amber-900, the only step dark enough to clear 4.5:1 over
        // an amber-50 fill, is hue 45.9. Judged on angle that reads as a
        // regression (30.7° → 17.4°); judged on the distance a reader actually
        // sees, it is an IMPROVEMENT, because the new ink is both darker and
        // less chromatic than the one it replaces:
        //
        //     prod ink vs red-700, dEok:  #b26205 0.1340  →  #7b3306 0.1421
        //
        // The seed's own hue gap is asserted separately (and unchanged) in
        // 'maps production to the amber preset, and keeps it clear of red'.
        const dEok = (a: string, b: string) => {
            const lab = (hex: string) => {
                const c = oklabChroma(hex); // forces the same conversion path
                const h = (oklabHue(hex) * Math.PI) / 180;
                return { a: c * Math.cos(h), b: c * Math.sin(h) };
            };
            const A = lab(a);
            const B = lab(b);
            const lum = (hex: string) => {
                const lin = (v: number) =>
                    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                const [r, g, bl] = [1, 3, 5].map((i) =>
                    lin(parseInt(hex.slice(i, i + 2), 16) / 255)
                );
                const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
                const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
                const s2 = Math.cbrt(0.088302462 * r + 0.2817188376 * g + 0.6299787005 * bl);
                return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2;
            };
            return Math.hypot(lum(a) - lum(b), A.a - B.a, A.b - B.b);
        };

        const prod = themeFor('prod');
        // ~0.14, five times the ~0.027 JND for a 10px glyph.
        expect(dEok(prod.textColor, '#c10007')).toBeGreaterThan(0.13); // red-700
        expect(dEok(prod.darkTextColor, '#ff6467')).toBeGreaterThan(0.13); // red-400
    });

    it('never prints an identity in the alarm’s own dark ink', () => {
        // `alarm` is `dark:text-amber-200` and prod shares amber's hue family.
        // Prod's dark ink steps to amber-100 for exactly this reason. Its LIGHT
        // ink IS amber-900, the alarm's light ink, and that is deliberate: what
        // separates the two chips is the FILL — 10.6x the chroma — which is the
        // mechanism DESIGN.md names as the reason `alarm` is the only chip with
        // one. Sharing an INK is free; sharing a FILL would not be.
        for (const name of ['dev', 'staging', 'prod', 'test']) {
            const t = themeFor(name);
            expect(t.darkTextColor).not.toBe('#fee685'); // amber-200
            expect(t.surfaceColor).not.toBe('#ffb900'); // amber-400, the alarm fill
            expect(t.darkSurfaceColor).not.toBe('#7b3306'); // amber-900, dark alarm fill
        }
    });
});

describe('extractDatadogInfoFromContainers', () => {
    it('should return null for empty containers array', () => {
        expect(extractDatadogInfoFromContainers([])).toBeNull();
    });

    it('should return null when no DD env vars are present', () => {
        const containers = [{ env: [{ name: 'FOO', value: 'bar' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should return null when only DD_SERVICE is present', () => {
        const containers = [{ env: [{ name: 'DD_SERVICE', value: 'my-service' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should return null when only DD_ENV is present', () => {
        const containers = [{ env: [{ name: 'DD_ENV', value: 'dev' }] }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should extract service and env when both are present', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'production' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'my-service',
            env: 'production'
        });
    });

    it('should extract service, env and version when all are present', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'production' },
                { name: 'DD_VERSION', value: 'main-1770831919-d4cd2de3ed1185943c9105df735a099a2165c7ce' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'my-service',
            env: 'production',
            version: 'main-1770831919-d4cd2de3ed1185943c9105df735a099a2165c7ce'
        });
    });

    it('should return info without version when DD_VERSION is absent', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: 'my-service' },
                { name: 'DD_ENV', value: 'staging' }
            ]
        }];
        const result = extractDatadogInfoFromContainers(containers);
        expect(result).toEqual({ service: 'my-service', env: 'staging' });
        expect(result?.version).toBeUndefined();
    });

    it('should find DD tags in a second container if first has none', () => {
        const containers = [
            { env: [{ name: 'FOO', value: 'bar' }] },
            {
                env: [
                    { name: 'DD_SERVICE', value: 'backend' },
                    { name: 'DD_ENV', value: 'staging' }
                ]
            }
        ];
        expect(extractDatadogInfoFromContainers(containers)).toEqual({
            service: 'backend',
            env: 'staging'
        });
    });

    it('should handle containers with no env field', () => {
        const containers = [{}];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });

    it('should ignore env vars with empty values', () => {
        const containers = [{
            env: [
                { name: 'DD_SERVICE', value: '' },
                { name: 'DD_ENV', value: 'dev' }
            ]
        }];
        expect(extractDatadogInfoFromContainers(containers)).toBeNull();
    });
});

describe('buildDatadogTestRunsUrl', () => {
    it('should build a URL with service and version', () => {
        const url = buildDatadogTestRunsUrl('my-service', 'v1.0.0');
        expect(url).toContain('https://app.datadoghq.com/ci/test/runs?query=');
        expect(url).toContain(encodeURIComponent('@test.service:my-service'));
        expect(url).toContain(encodeURIComponent('@version:v1.0.0'));
    });
});

describe('buildDatadogLogsUrl', () => {
    it('should build a URL with service and env', () => {
        const url = buildDatadogLogsUrl('my-service', 'production');
        expect(url).toContain('https://app.datadoghq.com/logs?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:production'));
        expect(url).toContain('&live=true');
    });
});

describe('buildDatadogTraceSearchUrl', () => {
    it('should build a URL with service, env, and version', () => {
        const url = buildDatadogTraceSearchUrl('my-service', 'production', 'v1.0.0');
        expect(url).toContain('https://app.datadoghq.com/apm/traces?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:production'));
        expect(url).toContain(encodeURIComponent('version:v1.0.0'));
        // `@rollout.test:true` marker is what distinguishes rollout-test
        // traces from the service Deployment's regular APM traffic; without
        // it the search would also surface unrelated traffic.
        expect(url).toContain(encodeURIComponent('@rollout.test:true'));
    });

    it('should omit the version filter when no version is provided', () => {
        const url = buildDatadogTraceSearchUrl('my-service', 'staging');
        expect(url).toContain('https://app.datadoghq.com/apm/traces?query=');
        expect(url).toContain(encodeURIComponent('service:my-service'));
        expect(url).toContain(encodeURIComponent('env:staging'));
        expect(url).toContain(encodeURIComponent('@rollout.test:true'));
        expect(url).not.toContain(encodeURIComponent('version:'));
    });
});

describe('shortenVersion', () => {
    it('returns empty string for nullish input', () => {
        expect(shortenVersion(null)).toBe('');
        expect(shortenVersion(undefined)).toBe('');
        expect(shortenVersion('')).toBe('');
    });

    it('shortens a full 40-char git SHA to 7 chars', () => {
        expect(shortenVersion('cf9292d57497bfccae1be39609c2c0e50b4de1ce')).toBe('cf9292d');
        expect(shortenVersion('7BD43E1956F3B822B948BD0EEA9DBD08B4673DDB')).toBe('7BD43E1');
    });

    it('keeps tag prefix and shortens long hex suffix after a dash', () => {
        expect(shortenVersion('main-1776963445-50ef792e2bd4b2c21c1e2b13f064e05c9e84034d'))
            .toBe('main-1776963445-50ef792');
        expect(shortenVersion('release-abcdef0123456789')).toBe('release-abcdef0');
    });

    it('leaves already-short SHAs alone', () => {
        expect(shortenVersion('a7e115f')).toBe('a7e115f');
        expect(shortenVersion('ebe9fb6')).toBe('ebe9fb6');
    });

    it('leaves non-hex versions alone', () => {
        expect(shortenVersion('1.2.3')).toBe('1.2.3');
        expect(shortenVersion('v1.2.3-rc1')).toBe('v1.2.3-rc1');
        expect(shortenVersion('0.3.0-1779831037')).toBe('0.3.0-1779831037');
        expect(shortenVersion('main-1.2.3')).toBe('main-1.2.3');
    });

    it('does not shorten short hex tails (<12 chars)', () => {
        expect(shortenVersion('release-abc1234')).toBe('release-abc1234');
    });
});

// ── Time formatters ──────────────────────────────────────────────────────
// These had ZERO coverage while carrying ~20 call sites (activity, apps,
// namespaces, rollouts, rollouts/history, StuckBadge). The day/month cutover
// was moved 30 -> 90 so that a 31-day-stale rollout reads "31d" rather than
// "1mo" — "1mo" next to "23d" makes an 8-day gap look far larger than it is.
// These tests pin that boundary so the rounding bug cannot come back quietly.

const T0 = new Date('2026-08-22T00:00:00Z');
// Build a timestamp exactly `n` units before T0.
const ago = (ms: number) => new Date(T0.getTime() - ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatTimeAgoCompact', () => {
    it('seconds below a minute', () => {
        expect(formatTimeAgoCompact(ago(0), T0)).toBe('0s');
        expect(formatTimeAgoCompact(ago(1 * SEC), T0)).toBe('1s');
        expect(formatTimeAgoCompact(ago(59 * SEC), T0)).toBe('59s');
    });

    it('rolls over s -> m -> h -> d at each boundary', () => {
        expect(formatTimeAgoCompact(ago(60 * SEC), T0)).toBe('1m');
        expect(formatTimeAgoCompact(ago(59 * MIN), T0)).toBe('59m');
        expect(formatTimeAgoCompact(ago(60 * MIN), T0)).toBe('1h');
        expect(formatTimeAgoCompact(ago(23 * HOUR), T0)).toBe('23h');
        expect(formatTimeAgoCompact(ago(24 * HOUR), T0)).toBe('1d');
    });

    it('THE BOUNDARY: 89d stays in days, 90d crosses to months', () => {
        expect(formatTimeAgoCompact(ago(89 * DAY), T0)).toBe('89d');
        expect(formatTimeAgoCompact(ago(90 * DAY), T0)).toBe('3mo');
    });

    it('keeps day precision across the old 30-day cutover (the actual bug)', () => {
        // 31d is the live prod case: it must NOT collapse to "1mo".
        expect(formatTimeAgoCompact(ago(23 * DAY), T0)).toBe('23d');
        expect(formatTimeAgoCompact(ago(29 * DAY), T0)).toBe('29d');
        expect(formatTimeAgoCompact(ago(30 * DAY), T0)).toBe('30d');
        expect(formatTimeAgoCompact(ago(31 * DAY), T0)).toBe('31d');
    });

    it('months start at 3 — 1mo and 2mo are unreachable by construction', () => {
        const emitted = new Set<string>();
        for (let d = 0; d <= 400; d++) emitted.add(formatTimeAgoCompact(ago(d * DAY), T0));
        expect(emitted.has('1mo')).toBe(false);
        expect(emitted.has('2mo')).toBe(false);
        expect(emitted.has('3mo')).toBe(true);
    });

    it('crosses to years at 12 months', () => {
        expect(formatTimeAgoCompact(ago(359 * DAY), T0)).toBe('11mo');
        expect(formatTimeAgoCompact(ago(360 * DAY), T0)).toBe('1y');
    });
});

describe('formatDuration', () => {
    it('singular vs plural on the small units', () => {
        expect(formatDuration(ago(1 * SEC), T0)).toBe('1 second');
        expect(formatDuration(ago(2 * SEC), T0)).toBe('2 seconds');
        expect(formatDuration(ago(1 * MIN), T0)).toBe('1 minute');
        expect(formatDuration(ago(2 * MIN), T0)).toBe('2 minutes');
        expect(formatDuration(ago(1 * HOUR), T0)).toBe('1 hour');
        expect(formatDuration(ago(2 * HOUR), T0)).toBe('2 hours');
    });

    it('THE SINGULAR/PLURAL DAY BOUNDARY: 1 day vs 2 days', () => {
        expect(formatDuration(ago(1 * DAY), T0)).toBe('1 day');
        expect(formatDuration(ago(2 * DAY), T0)).toBe('2 days');
    });

    it('THE BOUNDARY: 89 days stays in days, 90 days crosses to months', () => {
        expect(formatDuration(ago(89 * DAY), T0)).toBe('89 days');
        expect(formatDuration(ago(90 * DAY), T0)).toBe('3 months');
    });

    it('keeps day precision across the old 30-day cutover', () => {
        expect(formatDuration(ago(30 * DAY), T0)).toBe('30 days');
        expect(formatDuration(ago(31 * DAY), T0)).toBe('31 days');
    });

    it('months are always plural — "1 month"/"2 months" are unreachable', () => {
        const emitted = new Set<string>();
        for (let d = 0; d <= 400; d++) emitted.add(formatDuration(ago(d * DAY), T0));
        expect(emitted.has('1 month')).toBe(false);
        expect(emitted.has('2 months')).toBe(false);
        expect(emitted.has('3 months')).toBe(true);
    });

    it('but the YEARS singular branch is still live — "1 year" is reachable', () => {
        expect(formatDuration(ago(359 * DAY), T0)).toBe('11 months');
        expect(formatDuration(ago(360 * DAY), T0)).toBe('1 year');
        expect(formatDuration(ago(720 * DAY), T0)).toBe('2 years');
    });
});

describe('plainMessage', () => {
    // The controller writes its automatic promotions as Markdown emphasis, and
    // every surface that printed the string rendered the asterisks literally —
    // seven of them on one `/envs/*` screen.
    it('strips the emphasis the controller actually emits', () => {
        expect(plainMessage('*Automatic deployment*')).toBe('Automatic deployment');
        expect(plainMessage('**Automatic deployment**')).toBe('Automatic deployment');
        expect(plainMessage('_rolled back_')).toBe('rolled back');
        expect(plainMessage('deployed `9a1f4c2`')).toBe('deployed 9a1f4c2');
    });

    it('leaves prose that merely contains the characters alone', () => {
        expect(plainMessage('scale 2 * 3 replicas')).toBe('scale 2 * 3 replicas');
        expect(plainMessage('bump kube_state_metrics')).toBe('bump kube_state_metrics');
    });

    it('is empty, never undefined, for a missing message', () => {
        expect(plainMessage(undefined)).toBe('');
        expect(plainMessage(null)).toBe('');
        expect(plainMessage('   ')).toBe('');
    });
});

describe('shortenVersion — the 38-zero revision', () => {
    // `/envs/staging` printed `c0d3e880000000000000000000000000000000` where
    // every other page printed `c0d3e88`: the string was 38 chars, so the
    // 40-hex test missed it and the raw revision went straight to the DOM. The
    // fix is at the call site (use `getDisplayVersion`, the shared helper), but
    // the boundary is worth pinning.
    it('shortens a real 40-char sha and passes anything shorter through', () => {
        const sha40 = 'c0d3e88' + '0'.repeat(33);
        expect(sha40).toHaveLength(40);
        expect(shortenVersion(sha40)).toBe('c0d3e88');
        expect(shortenVersion(sha40.slice(0, 38))).toHaveLength(38);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// `detectStuckBehind` — B1, OPERATOR-WALK FINDING (2026-09-03, fourth walk).
//
// `/apps` printed `hello-world-app — DEV is stuck / No progress for 31m and
// nothing is holding it on purpose.` for a rollout the API itself reported
// `schedule-gate-fk44d passing:false` for — a legitimate, self-clearing
// hold, the same kind `promotion.ts`'s `detectStuckPromotion` already knows
// to excuse. `classifyCell` (`/apps/+page.svelte`) calls THIS function for
// its cross-environment comparison and it had no gate awareness at all: any
// rollout behind a peer for >24h read `stuck`, contract-held, schedule-held
// or genuinely wedged alike. These pin the fix — `detectStuckBehind` now
// asks the same `blockNeedsPerson` question `detectStuckPromotion` does
// before ever looking at peer staleness.
// ─────────────────────────────────────────────────────────────────────────
describe('detectStuckBehind — gates take precedence over peer staleness', () => {
    const NOW = new Date('2026-09-03T13:30:00Z');

    function makeRollout(opts: {
        current: string;
        timestamp: string;
        pastVersions?: string[]; // history[1..], oldest last — so `compareRollouts` can find overlap
        releaseCandidates?: { version: string; tag: string; created: string }[];
        gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
    }): any {
        const history = [{ version: { version: opts.current }, timestamp: opts.timestamp, bakeStatus: 'Succeeded' }];
        for (const v of opts.pastVersions ?? []) {
            history.push({ version: { version: v }, timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' });
        }
        return {
            metadata: { name: 'hello-world-app', namespace: 'hello-world-dev' },
            spec: {},
            status: {
                history,
                releaseCandidates: opts.releaseCandidates ?? [],
                gates: opts.gates ?? []
            }
        };
    }

    // The peer (staging) advanced onto the newer build over a day ago, so
    // the OLD peer-staleness-only test would call `myRollout` stuck no
    // matter why it has not followed. Its history carries `myPastVersion`
    // as a PAST deploy, which is what tells `compareRollouts` staging has
    // already moved past the version `myRollout` is still on — the same
    // "my version appears in the peer's history" shape the live payload
    // has (dev and staging share deploy history on the same app).
    function farAheadPeer(myPastVersion: string): any {
        return makeRollout({
            current: '064b655',
            timestamp: '2026-09-01T12:00:00Z',
            pastVersions: [myPastVersion]
        });
    }

    it('B1 repro: rolled back into a schedule hold — behind a peer for a day, but NOT stuck', () => {
        const myRollout = makeRollout({
            current: '0afab6f',
            // 8.5h since the rollback landed — this is the fact the old
            // "No progress for 31m" sentence got wrong further up the
            // stack too, but here it matters only insofar as it is well
            // past the 24h... it is NOT, which is also the point: this
            // must not read stuck even measured from a much older instant.
            timestamp: '2026-09-03T05:00:00Z',
            releaseCandidates: [{ version: '064b655', tag: '064b655', created: '2026-09-02T20:30:00Z' }],
            gates: [{ name: 'schedule-gate-fk44d', passing: false, allowedVersions: null }]
        });
        expect(
            detectStuckBehind(myRollout, farAheadPeer('0afab6f'), 'staging', { now: NOW })
        ).toBeNull();
    });

    it('a peer merely ahead with NO blocking gate is still caught (the pre-existing case, unchanged)', () => {
        const myRollout = makeRollout({
            current: 'old-build',
            timestamp: '2026-09-01T00:00:00Z'
        });
        const reason = detectStuckBehind(myRollout, farAheadPeer('old-build'), 'staging', { now: NOW });
        expect(reason).not.toBeNull();
        expect(reason?.kind).toBe('behind');
    });

    it('a block that genuinely needs a person (hand-authored approval) is still stuck', () => {
        const myRollout = makeRollout({
            current: '0afab6f',
            timestamp: '2026-09-01T00:00:00Z',
            releaseCandidates: [{ version: '064b655', tag: '064b655', created: '2026-09-01T00:00:00Z' }],
            gates: [{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }]
        });
        const reason = detectStuckBehind(myRollout, farAheadPeer('0afab6f'), 'staging', { now: NOW });
        expect(reason).not.toBeNull();
        expect(reason?.kind).toBe('behind');
    });
});
