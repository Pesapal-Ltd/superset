# ---------------------------------------------------------------------------
# Pesapal extensions: Semantic Model (DAX measures), what-if parameters
# ---------------------------------------------------------------------------
# DAX measures and what-if parameters are compiled to SQL with Jinja templates.
FEATURE_FLAGS = {**globals().get("FEATURE_FLAGS", {}), "ENABLE_TEMPLATE_PROCESSING": True}


def _dax_helper(name):  # imported lazily: this file is read while Superset starts
    def call(*args, **kwargs):
        from superset.semantic import dax

        return getattr(dax, name)(*args, **kwargs)

    call.__name__ = name
    return call


JINJA_CONTEXT_ADDONS = {
    **globals().get("JINJA_CONTEXT_ADDONS", {}),
    **{n: _dax_helper(n) for n in ("dax_over", "dax_ok", "dax_num", "dax_partition")},
}
