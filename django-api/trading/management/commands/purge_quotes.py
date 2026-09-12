"""Удаление старых тиков котировок.

Таблица `quotes` растёт примерно на 14 МБ в сутки (8 пар × тик раз в 10 с) и
ничем не ограничена — на сервере с 2.5 ГБ свободного диска это упирается в
потолок за полгода. График глубже нескольких суток не показывает, поэтому
сырые тики старше N дней смысла не имеют.

    python manage.py purge_quotes                 # удалить старше 30 дней
    python manage.py purge_quotes --days 7
    python manage.py purge_quotes --dry-run       # только показать, сколько удалится
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from trading.models import Quote

DEFAULT_DAYS = 30
# Удаляем пачками: одна большая DELETE на сотни тысяч строк держит блокировку
# и раздувает WAL, что на 1 CPU / 960 МБ заметно.
BATCH_SIZE = 10_000


class Command(BaseCommand):
    help = "Удаляет тики котировок старше указанного числа дней"

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=DEFAULT_DAYS,
            help=f"хранить тики за последние N дней (по умолчанию {DEFAULT_DAYS})",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="посчитать, но не удалять",
        )

    def handle(self, *args, **options):
        days = options["days"]
        if days < 1:
            self.stderr.write("--days должно быть больше нуля")
            return

        cutoff = timezone.now() - timezone.timedelta(days=days)
        stale = Quote.objects.filter(timestamp__lt=cutoff)
        total = stale.count()

        if options["dry_run"]:
            self.stdout.write(f"Под удаление попадает тиков: {total} (старше {cutoff:%Y-%m-%d})")
            return

        deleted = 0
        while True:
            batch_ids = list(
                Quote.objects.filter(timestamp__lt=cutoff).values_list("id", flat=True)[:BATCH_SIZE]
            )
            if not batch_ids:
                break
            removed, _ = Quote.objects.filter(id__in=batch_ids).delete()
            deleted += removed

        self.stdout.write(
            self.style.SUCCESS(f"Удалено тиков: {deleted} (старше {cutoff:%Y-%m-%d})")
        )
