# Contributing to PoleCheck Desktop

Thank you for your interest in contributing to PoleCheck Desktop! This document provides guidelines and information for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Issue Reporting](#issue-reporting)

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/polecheck-desktop.git
   cd polecheck-desktop
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/polecheck-desktop.git
   ```

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Environment Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Create a `.env` file in the project root:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
   ```

3. **Download the ONNX model**:
   - Download from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/resolve/main/depth%5Fanything%5Fv2%5Fmetric%5Fvkitti%5Fvits.pth?download=true)
   - Convert to ONNX format
   - Place in `src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx`

4. **Start development server**:
   ```bash
   npm run dev
   ```

## Code Style

### TypeScript

- Use TypeScript for all new code
- Prefer interfaces over types for object shapes
- Use strict type checking
- Avoid `any` - use proper types or `unknown`

### React

- Use functional components with hooks
- Prefer `useCallback` and `useMemo` for performance
- Use CSS Modules for styling
- Follow the existing component structure

### ESLint Rules

We enforce zero ESLint errors. Run before committing:
```bash
npm run lint
```

### File Naming

- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- Constants: `UPPER_SNAKE_CASE.ts`
- CSS Modules: `ComponentName.module.css`

## Testing

### Pre-commit Checks

Before submitting a PR, ensure:

1. **Linting passes**:
   ```bash
   npm run lint
   ```

2. **Type checking passes**:
   ```bash
   npm run typecheck
   ```

3. **Build succeeds**:
   ```bash
   npm run build
   ```

### Manual Testing

Test the following workflows:
- [ ] Location search works
- [ ] Depth map generation works
- [ ] Horizon calibration works
- [ ] Height measurements work
- [ ] Settings panel works
- [ ] CSV export works
- [ ] Keyboard shortcuts work

## Pull Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines

3. **Test your changes** thoroughly

4. **Update documentation** if needed

5. **Commit your changes** with a descriptive message

6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Create a Pull Request** with:
   - Clear title describing the change
   - Detailed description of what was changed
   - Screenshots if UI changes
   - Test results

### PR Review Checklist

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] No ESLint errors

## Commit Message Guidelines

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(measurement): add keyboard shortcuts for measurements

fix(depth): resolve ONNX model loading issue on Windows

docs(readme): update installation instructions

style(components): improve button styling consistency
```

## Issue Reporting

### Before Reporting

1. Check existing issues for duplicates
2. Try the latest version
3. Reproduce the issue consistently

### Issue Template

Use this template when reporting issues:

```markdown
## Bug Report

**Version**: [e.g., v0.0.1]

**Platform**: [Windows/macOS/Linux]

**Steps to Reproduce**:
1. 
2. 
3. 

**Expected Behavior**:

**Actual Behavior**:

**Screenshots** (if applicable):

**Console Logs** (if applicable):

**Additional Context**:
```

### Feature Requests

For feature requests, include:
- Use case description
- Expected benefits
- Implementation suggestions (if any)
- Priority level

## Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: New features
- `fix/*`: Bug fixes
- `docs/*`: Documentation updates

## Getting Help

- Check the [README.md](README.md) for setup instructions
- Review existing issues and PRs
- Ask questions in GitHub Discussions
- Join our community chat (if available)

## License

By contributing to PoleCheck Desktop, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to PoleCheck Desktop! 🚀 