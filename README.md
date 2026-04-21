# Neiry Hyperscan WebApp

Веб-приложение для работы с нейроинтерфейсами Neiry (Hyperscan) через Bluetooth.

## Возможности

- Подключение к устройствам Neiry Headband через Web Bluetooth API
- Визуализация EEG-данных в реальном времени
- Запись и экспорт сессий
- Тестирование максимального количества одновременных подключений

## Технологии

- React 19 + TypeScript
- Vite 7
- Tailwind CSS v3
- shadcn/ui компоненты
- Web Bluetooth API

## Установка

```bash
npm install
```

## Запуск

```bash
npm run dev
```

## Сборка

```bash
npm run build
```

## Структура проекта

```
src/
  components/     UI-компоненты
  hooks/          React-хуки
  lib/            Утилиты, Bluetooth-логика, парсер протокола
  pages/          Страницы приложения
  types/          TypeScript-типы
```
