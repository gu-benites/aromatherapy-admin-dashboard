• Yes. With these screenshots, the full logic is now clear:

  - The click workflows manage Shape A's filtros.
  - The later filter steps run sequentially and update Shape A's oilList by intersection.
  - Step preg-100 is special: it searches oils that contain pregnancy-safe-100 and do not contain pregnancy-safe-3months.

  So if both Seguros 1º ao 3º and Seguros 2º ao 3º are active at the same time:

  1. Step 21 runs because Shape A's filtros contains pregnancy-safe-100.
  2. It narrows oilList to oils with pregnancy-safe-100 but without pregnancy-safe-3months.
  3. Step 23 runs because Shape A's filtros contains pregnancy-safe-3months.
  4. It intersects that already-narrowed list with oils that have pregnancy-safe-3months.
  5. Result: empty, because Step 21 already removed that group.

  So the actual Bubble pipeline meaning is:

  pregnancy-safe-3months = safe from 1st trimester onward
  pregnancy-safe-100     = safe from 2nd to 3rd trimester, but Bubble excludes 3months in the filter step
  pregnancy-safe-50      = professional guidance / prescription

  I updated the cheat sheet to document this sequential pipeline and the preg-100 exclusion rule:

  pregnancy-labels/pregnancy-label-cheat-sheet.md:56


› Yes... those sequencial interesections of oillists are crucial because i can have 2 chiptags selected at Shape A´s filtros


• Exactly. The real behavior is:

  Shape A's filtros = selected chip tags
  Shape A's oilList = current candidate oil list
  Each filter step = oilList intersect matching oils

  So multiple chip tags are combined with AND logic through sequential intersections.

  For pregnancy specifically:

  if filtros contains pregnancy-safe-100:
    oilList = oilList ∩ oils(has pregnancy-safe-100 AND not has pregnancy-safe-3months)

  if filtros contains pregnancy-safe-50:
    oilList = oilList ∩ oils(has pregnancy-safe-50)

  if filtros contains pregnancy-safe-3months:
    oilList = oilList ∩ oils(has pregnancy-safe-3months)

  That means the ordering matters, and the pregnancy-safe-100 step is not just a plain tag filter. It is an exclusive second-to-third-trimester filter because of the extra
  doesn't contain pregnancy-safe-3months constraint.

  For Supabase/Postgres, this should be modeled as composable filter predicates over the current oil query, not as one selected pregnancy enum.