# Contributing to PoleCheck Desktop

Thank you for your interest in contributing to PoleCheck Desktop. This document provides guidelines for contributing to the project.

## Development Setup

1. Follow the setup instructions in [README.md](./README.md#setup-and-installation)
2. Ensure you have Node.js 18+ and Git LFS installed
3. Run `npm install` to install dependencies
4. Set up your Google Maps API key in `.env`

## Code Quality Standards

### Pre-commit Requirements
Before submitting changes, ensure:

```bash
npm run validate  # Runs type checking, linting, and tests
```

This command executes:
- TypeScript type checking (`npm run typecheck:strict`)
- ESLint linting (`npm run lint`)
- All test suites (`npm run test:all`)

### Code Style
- Use TypeScript with strict type checking
- Follow ESLint configuration (zero warnings/errors required)
- Use CSS Modules for component styling
- Write descriptive commit messages

### Testing Requirements
- Add unit tests for new services and utilities
- Add integration tests for new workflows
- Maintain existing test coverage
- Update tests when modifying existing functionality

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Run the validation suite
4. Commit with descriptive messages
5. Push your branch
6. Create a pull request

## Project Structure

- `src/components/`: React UI components
- `src/services/`: Business logic and utilities
- `src/stores/`: Zustand state management
- `src/types/`: TypeScript type definitions
- `src/tests/`: Test files organized by type
- `electron/`: Electron main process code

## Pull Request Guidelines

- Provide clear description of changes
- Reference any related issues
- Ensure all tests pass
- Update documentation if needed
- Keep PRs focused and reasonably sized

## Reporting Issues

When reporting bugs or requesting features:
- Use the GitHub issue templates
- Provide clear reproduction steps
- Include system information (OS, Node version)
- Attach relevant logs or screenshots

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
