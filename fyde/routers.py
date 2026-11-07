class CompanyRouter:
    """Company data has no foreign keys or database credentials shared with customers."""

    def db_for_read(self, model, **hints):
        return "company" if model._meta.app_label == "company" else "default"

    db_for_write = db_for_read

    def allow_relation(self, obj1, obj2, **hints):
        return (obj1._meta.app_label == "company") == (obj2._meta.app_label == "company")

    def allow_migrate(self, db, app_label, **hints):
        return (db == "company") == (app_label == "company")
