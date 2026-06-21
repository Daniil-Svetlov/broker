"""Закрытие истёкших сделок.

В JS закрытие висело на setTimeout внутри процесса. Здесь это отдельная
задача, которую можно гонять по cron/таймеру или в режиме --watch.

    python manage.py settle_trades            # один прогон
    python manage.py settle_trades --watch    # демон, опрос каждые --interval сек
"""
import time

from django.core.management.base import BaseCommand

from trading.services import settle_due_trades


class Command(BaseCommand):
    help = "Закрывает открытые сделки с истёкшим сроком"

    def add_arguments(self, parser):
        parser.add_argument(
            "--watch",
            action="store_true",
            help="работать демоном и периодически закрывать истёкшие сделки",
        )
        parser.add_argument(
            "--interval",
            type=float,
            default=1.0,
            help="период опроса в секундах для --watch (по умолчанию 1.0)",
        )

    def handle(self, *args, **options):
        if not options["watch"]:
            count = settle_due_trades()
            self.stdout.write(self.style.SUCCESS(f"Закрыто сделок: {count}"))
            return

        interval = options["interval"]
        self.stdout.write(self.style.SUCCESS(f"watch: опрос каждые {interval}с (Ctrl+C — выход)"))
        try:
            while True:
                count = settle_due_trades()
                if count:
                    self.stdout.write(f"Закрыто сделок: {count}")
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Остановлено"))
