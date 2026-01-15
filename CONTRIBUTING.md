# Contributing to C4-Memory

Thank you for your interest in contributing to C4-Memory! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Be kind to others, accept constructive criticism, and focus on what's best for the community.

## How to Contribute

### Reporting Bugs

1. **Search existing issues** to avoid duplicates
2. **Create a new issue** with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, Claude Code version)

### Suggesting Features

1. **Check existing issues** for similar suggestions
2. **Open a feature request** with:
   - Clear description of the feature
   - Use case / problem it solves
   - Proposed implementation (optional)

### Pull Requests

1. **Fork the repository**
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our coding standards
4. **Write/update tests** for your changes
5. **Run the test suite**:
   ```bash
   npm test
   ```
6. **Submit a pull request** with:
   - Clear description of changes
   - Link to related issue (if any)
   - Screenshots/examples if applicable

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/c4-memory.git
cd c4-memory

# Install dependencies
npm install

# Build the project
npm run build

# Run in watch mode for development
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format
```

## Project Structure

```
c4-memory/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── cli.ts            # CLI entry point
│   ├── types.ts          # TypeScript type definitions
│   ├── aime/             # AIME compression system
│   │   ├── encoder.ts    # Text -> AIME encoding
│   │   ├── decoder.ts    # AIME -> Text decoding
│   │   ├── symbols.ts    # Symbol definitions
│   │   └── grammar.ts    # Grammar rules
│   ├── db/               # Database layer
│   │   ├── schema.ts     # SQLite schema
│   │   ├── operations.ts # CRUD operations
│   │   └── embeddings.ts # Vector embeddings
│   ├── tools/            # MCP tool implementations
│   │   ├── remember.ts
│   │   ├── recall.ts
│   │   ├── refresh.ts
│   │   ├── forget.ts
│   │   ├── stats.ts
│   │   ├── config.ts
│   │   └── learn.ts
│   ├── auto/             # Auto-learning system
│   │   ├── detector.ts   # Pattern detection
│   │   └── triggers.ts   # Learning triggers
│   └── config/           # Configuration management
├── tests/                # Test files
├── docs/                 # Documentation
└── .github/              # GitHub Actions workflows
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Document public functions with JSDoc

### Formatting

- Use Prettier for formatting (runs automatically via pre-commit hook)
- 2 spaces for indentation
- Single quotes for strings
- Trailing commas in multi-line

### Naming

- `camelCase` for variables and functions
- `PascalCase` for types and interfaces
- `UPPER_SNAKE_CASE` for constants
- Descriptive names over abbreviations

### Testing

- Write tests for new functionality
- Aim for 80%+ coverage
- Use descriptive test names
- Test edge cases and error conditions

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

Examples:
```
feat(aime): add support for Python-specific patterns
fix(recall): handle empty search results correctly
docs: update installation instructions
```

## Areas for Contribution

### Good First Issues

Look for issues labeled `good first issue` - these are great for newcomers.

### Feature Ideas

- Additional language patterns in AIME
- Alternative embedding providers (Cohere, local models)
- Memory visualization tool
- Import/export formats (Markdown, JSON-LD)
- VS Code extension integration

### Documentation

- Tutorial improvements
- API documentation
- Example use cases
- Translation to other languages

## Questions?

- Open a [Discussion](https://github.com/YOUR_USERNAME/c4-memory/discussions)
- Tag maintainers on relevant issues

Thank you for contributing!
