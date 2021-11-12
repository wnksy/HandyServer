# Important

**This software is only intended for advanced users with appropriate knowledge of networks configuration. It's not for the average user.**

**I have very little free time so I can't offer any support.**


# What is this?

HandyServer allows applications to control a Handy masturbator completely offline by emulating the official server.

The server listens on port:
- 443 (HTTPS) for the Handy connection
- 80 (HTTP) for control by applications via API v1 (see *Limitations and risks*)


# Requirements

- Local DNS server (ie. Pi-hole)
- Handy running FW 2.x (tested with 2.13.0)
- A device supporting NodeJS to run HandyServer


# Limitations and risks

- Only expects 1 Handy device connection at any given time.
- Control by applications is via unencrypted HTTP, so you should either run HandyServer in the same PC running the controlling application or within a network that you fully control, for privacy reasons. Alternatively, you could change the code to use TLS for the control connection as well.


# How to use

1. Configure your local DNS server so that `www.handyfeeling.com` is resolved to the IP address of the computer running HandyServer.
2. Run `node index.js` (on some operating systems you will need extra configuration to allow listening on ports <1000)
3. Configure the controlling application to use HandyServer by entering the API URL `http://localhost/` or whatever appropriate, depending where you are running HandyServer.


# FAQs
- *Can this be adapted for FW 3.x?*

    No, FW 3 uses a different server endpoint and it validates the server certificate, so it will abort the connection.

- *Can this be adapted to expose the API v2?*

    To some extent, yes. But new features would not work as they're simply missing in FW 2.x.
