# Oracle Engine source note

This package is an independent implementation of the public-domain three-coin I Ching method and the traditional King Wen hexagram ordering.

The design phase consulted the following open-source projects as behavioral references; no runtime dependency or copied modern interpretation text is included:

- `limjiechao/ts-hexagram-generator` (MIT): pure domain modeling and cast-record structure.
- `Brianfit/I-Ching` (MIT): independent comparison for three-coin probabilities.
- `DaviRain-Su/classic_system` (MIT code; some content CC BY-SA 4.0): matrix and visualization structure only. No modern text was copied.

The package contains only structural facts: coin outcomes, line values, trigram pairs, traditional Chinese hexagram names and King Wen numbers. It deliberately contains no fortune claim, modern commentary, crystal-effect claim, product identifier, pricing rule or user data.
