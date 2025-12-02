"""
Groq RPG Simulator - Main Entry Point

A reality-first RPG simulation engine powered by Groq's fast inference.
"""

import sys
import os


def main():
    """Main entry point for the Groq RPG Simulator."""
    # Check for API key
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("ERROR: GROQ_API_KEY environment variable not set.")
        print("")
        print("To use the Groq RPG Simulator, you need a Groq API key.")
        print("1. Get your API key from: https://console.groq.com/keys")
        print("2. Set the environment variable:")
        print("   export GROQ_API_KEY='your_api_key_here'")
        print("")
        print("Or create a .env file with:")
        print("   GROQ_API_KEY=your_api_key_here")
        sys.exit(1)

    # Import and run the app
    from .ui import GroqRPGApp

    app = GroqRPGApp()
    app.run()


if __name__ == "__main__":
    main()
